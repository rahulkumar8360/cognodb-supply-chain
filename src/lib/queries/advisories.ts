import { runQuery, runQuerySingle } from "../neo4j";

import type { AdvisorySummary, Criticality, RouteStep, Severity } from "./types";

export type AdvisoryListItem = AdvisorySummary & {
  packageName: string;
  packageVersion: string;
  vulnerableRange: string;
  patchedIn: string;
  /** Applications reachable over installed (runtime) dependencies only. */
  exposedApplications: number;
  tierOneExposed: number;
};

export type AdvisoryFilter = {
  severities: Severity[];
  /** Only advisories that reach at least one application. */
  exposedOnly: boolean;
  search: string;
  limit: number;
  offset: number;
};

/**
 * The advisory feed, ranked by what it can actually reach.
 *
 * Note the filters: an empty `severities` array means "no filter", which is
 * expressed as `size($severities) = 0 OR adv.severity IN $severities` rather
 * than by assembling a different query string. Every filter in this file works
 * that way — one query text, one execution plan, all variation in parameters.
 */
export async function listAdvisories(filter: AdvisoryFilter): Promise<AdvisoryListItem[]> {
  return runQuery<AdvisoryListItem>(
    `MATCH (adv:Advisory)-[affects:AFFECTS]->(pkg:Package)
     WHERE (size($severities) = 0 OR adv.severity IN $severities)
       AND ($search = '' OR toLower(adv.id) CONTAINS toLower($search)
                         OR toLower(pkg.name) CONTAINS toLower($search)
                         OR toLower(adv.summary) CONTAINS toLower($search))
     OPTIONAL MATCH (app:Application)-[:DEPENDS_ON*1..5]->(pkg)
     WITH adv, affects, pkg, collect(DISTINCT app) AS apps
     WHERE NOT $exposedOnly OR size(apps) > 0
     RETURN
       adv.id AS id,
       adv.severity AS severity,
       adv.cvss AS cvss,
       adv.cwe AS cwe,
       adv.summary AS summary,
       adv.publishedAt AS publishedAt,
       adv.simulated AS simulated,
       pkg.name AS packageName,
       pkg.version AS packageVersion,
       affects.vulnerableRange AS vulnerableRange,
       affects.patchedIn AS patchedIn,
       size(apps) AS exposedApplications,
       size([a IN apps WHERE a.criticality = 'tier-1']) AS tierOneExposed
     ORDER BY tierOneExposed DESC, exposedApplications DESC, adv.cvss DESC, adv.id ASC
     SKIP $offset LIMIT $limit`,
    filter,
  );
}

export async function countAdvisories(filter: Pick<AdvisoryFilter, "severities" | "search">): Promise<number> {
  const row = await runQuerySingle<{ total: number }>(
    `MATCH (adv:Advisory)-[:AFFECTS]->(pkg:Package)
     WHERE (size($severities) = 0 OR adv.severity IN $severities)
       AND ($search = '' OR toLower(adv.id) CONTAINS toLower($search)
                         OR toLower(pkg.name) CONTAINS toLower($search)
                         OR toLower(adv.summary) CONTAINS toLower($search))
     RETURN count(*) AS total`,
    filter,
  );
  return row?.total ?? 0;
}

export type BlastRadiusRow = {
  applicationId: string;
  applicationName: string;
  team: string;
  criticality: Criticality;
  environment: "production" | "internal";
  /** Hop count of the shortest fully-installed route, or null when there isn't one. */
  installedHops: number | null;
  /** Hop count of the shortest declared route, following optional and dev edges too. */
  declaredHops: number | null;
  /** The shortest installed route if there is one, otherwise the declared route. */
  route: RouteStep[];
  /** True when the only way in is through an optional or dev dependency. */
  declaredOnly: boolean;
};

export type BlastRadius = {
  advisory: AdvisorySummary;
  packageName: string;
  packageVersion: string;
  vulnerableRange: string;
  patchedIn: string;
  rows: BlastRadiusRow[];
};

/**
 * THE query this application exists for: given one advisory, which of our
 * applications is exposed, by what route, and how far away is it?
 *
 * Three things here are hard to do in a relational schema and easy here:
 *
 *   1. The hop count is unbounded in the schema. In SQL this is a recursive
 *      CTE that has to be written, tuned and re-tuned as the tree deepens.
 *   2. `shortestPath` returns the *route*, not just the fact of a connection —
 *      so the answer to "why is this in my build?" comes back with the query,
 *      rather than needing a second pass to reconstruct it.
 *   3. Running the same traversal twice over different relationship types
 *      distinguishes "this ships in production" from "this is declared but may
 *      never be installed", which is the difference between an incident and a
 *      ticket. In SQL both traversals would be separate recursive CTEs over a
 *      scope-filtered edge table.
 *
 * `maxDepth` is a real parameter because the path is bound here and can be
 * measured with `length()`.
 */
export async function getBlastRadius(advisoryId: string, maxDepth: number): Promise<BlastRadius | null> {
  const header = await runQuerySingle<{
    advisory: AdvisorySummary;
    packageName: string;
    packageVersion: string;
    vulnerableRange: string;
    patchedIn: string;
  }>(
    `MATCH (adv:Advisory { id: $advisoryId })-[affects:AFFECTS]->(pkg:Package)
     RETURN
       { id: adv.id, severity: adv.severity, cvss: adv.cvss, cwe: adv.cwe,
         summary: adv.summary, publishedAt: adv.publishedAt, simulated: adv.simulated } AS advisory,
       pkg.name AS packageName,
       pkg.version AS packageVersion,
       affects.vulnerableRange AS vulnerableRange,
       affects.patchedIn AS patchedIn`,
    { advisoryId },
  );

  if (!header) return null;

  const rows = await runQuery<BlastRadiusRow>(
    `MATCH (:Advisory { id: $advisoryId })-[:AFFECTS]->(vulnerable:Package)
     MATCH (app:Application)
     OPTIONAL MATCH installed = shortestPath((app)-[:DEPENDS_ON*1..5]->(vulnerable))
     OPTIONAL MATCH declared = shortestPath((app)-[:DEPENDS_ON|DEPENDS_ON_OPTIONAL|DEPENDS_ON_DEV*1..5]->(vulnerable))
     WITH app,
          CASE WHEN installed IS NOT NULL AND length(installed) <= $maxDepth THEN installed END AS installed,
          CASE WHEN declared IS NOT NULL AND length(declared) <= $maxDepth THEN declared END AS declared
     WHERE installed IS NOT NULL OR declared IS NOT NULL
     WITH app, installed, declared, coalesce(installed, declared) AS route
     RETURN
       app.id AS applicationId,
       app.name AS applicationName,
       app.team AS team,
       app.criticality AS criticality,
       app.environment AS environment,
       CASE WHEN installed IS NULL THEN null ELSE length(installed) END AS installedHops,
       CASE WHEN declared IS NULL THEN null ELSE length(declared) END AS declaredHops,
       installed IS NULL AS declaredOnly,
       [n IN nodes(route) | {
         kind: CASE WHEN n:Application THEN 'application' ELSE 'package' END,
         id: coalesce(n.id, n.name),
         label: n.name
       }] AS route
     ORDER BY declaredOnly ASC, app.criticality ASC, installedHops ASC, applicationName ASC`,
    { advisoryId, maxDepth },
  );

  return { ...header, rows };
}

export type SeverityByWeakness = { cwe: string; total: number; exposed: number };

/** Advisories grouped by weakness class — the shape of the risk, not just its size. */
export async function getWeaknessBreakdown(): Promise<SeverityByWeakness[]> {
  return runQuery<SeverityByWeakness>(
    `MATCH (adv:Advisory)-[:AFFECTS]->(pkg:Package)
     OPTIONAL MATCH (app:Application)-[:DEPENDS_ON*1..5]->(pkg)
     WITH adv, count(DISTINCT app) AS exposedApps
     WITH adv.cwe AS cwe, collect(exposedApps > 0) AS exposures
     RETURN cwe, size(exposures) AS total, size([e IN exposures WHERE e]) AS exposed
     ORDER BY exposed DESC, total DESC`,
  );
}
