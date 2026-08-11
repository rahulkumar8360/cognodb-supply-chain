import { runQuery, runQuerySingle } from "../neo4j";

import type { ApplicationExposure } from "./overview";
import type { AdvisorySummary, ApplicationSummary, Criticality, RouteStep } from "./types";

export async function listApplications(): Promise<ApplicationSummary[]> {
  return runQuery<ApplicationSummary>(
    `MATCH (app:Application)
     RETURN app.id AS id, app.name AS name, app.team AS team,
            app.criticality AS criticality, app.environment AS environment,
            app.description AS description
     ORDER BY app.criticality ASC, app.name ASC`,
  );
}

export type ApplicationFinding = AdvisorySummary & {
  packageName: string;
  packageVersion: string;
  patchedIn: string;
  hops: number;
  route: RouteStep[];
  /** True when the package is only reachable through an optional or dev dependency. */
  declaredOnly: boolean;
};

export type ApplicationDirectDependency = {
  name: string;
  version: string;
  versionRange: string;
  scope: string;
  weeklyDownloads: number;
  /** Packages this direct dependency drags in behind it. */
  transitivePackages: number;
  advisories: number;
};

export type ApplicationDetail = ApplicationSummary & {
  installedPackages: number;
  declaredOnlyPackages: number;
  directDependencies: ApplicationDirectDependency[];
  findings: ApplicationFinding[];
};

/**
 * One application's full picture: what it installs, and every advisory that
 * reaches it with the route that gets there.
 *
 * The findings query is the multi-hop traversal this whole application is built
 * around, run from a single starting node. Sorting by hop count puts the direct
 * dependencies — the ones the team can actually fix by editing their own
 * package.json — above the ones inherited four levels down.
 */
export async function getApplicationDetail(id: string): Promise<ApplicationDetail | null> {
  const app = await runQuerySingle<ApplicationSummary>(
    `MATCH (app:Application { id: $id })
     RETURN app.id AS id, app.name AS name, app.team AS team,
            app.criticality AS criticality, app.environment AS environment,
            app.description AS description`,
    { id },
  );

  if (!app) return null;

  const [counts, directDependencies, findings] = await Promise.all([
    runQuerySingle<{ installedPackages: number; declaredOnlyPackages: number }>(
      `MATCH (app:Application { id: $id })
       OPTIONAL MATCH (app)-[:DEPENDS_ON*1..5]->(installed:Package)
       WITH app, count(DISTINCT installed) AS installedCount
       OPTIONAL MATCH (app)-[:DEPENDS_ON|DEPENDS_ON_OPTIONAL|DEPENDS_ON_DEV*1..5]->(declared:Package)
       WITH installedCount, count(DISTINCT declared) AS declaredCount
       RETURN installedCount AS installedPackages,
              declaredCount - installedCount AS declaredOnlyPackages`,
      { id },
    ),
    runQuery<ApplicationDirectDependency>(
      `MATCH (:Application { id: $id })-[dep:DEPENDS_ON|DEPENDS_ON_DEV]->(pkg:Package)
       OPTIONAL MATCH (pkg)-[:DEPENDS_ON*1..5]->(behind:Package)
       WITH pkg, dep, count(DISTINCT behind) AS transitivePackages
       OPTIONAL MATCH (pkg)<-[:AFFECTS]-(adv:Advisory)
       RETURN pkg.name AS name, pkg.version AS version, dep.versionRange AS versionRange,
              dep.scope AS scope, pkg.weeklyDownloads AS weeklyDownloads,
              transitivePackages, count(DISTINCT adv) AS advisories
       ORDER BY advisories DESC, transitivePackages DESC, pkg.name ASC`,
      { id },
    ),
    runQuery<ApplicationFinding>(
      `MATCH (app:Application { id: $id })
       MATCH (app)-[:DEPENDS_ON|DEPENDS_ON_OPTIONAL|DEPENDS_ON_DEV*1..5]->(pkg:Package)<-[affects:AFFECTS]-(adv:Advisory)
       WITH DISTINCT app, pkg, affects, adv
       OPTIONAL MATCH installed = shortestPath((app)-[:DEPENDS_ON*1..5]->(pkg))
       MATCH declared = shortestPath((app)-[:DEPENDS_ON|DEPENDS_ON_OPTIONAL|DEPENDS_ON_DEV*1..5]->(pkg))
       WITH pkg, affects, adv, coalesce(installed, declared) AS route, installed IS NULL AS declaredOnly
       RETURN
         adv.id AS id, adv.severity AS severity, adv.cvss AS cvss, adv.cwe AS cwe,
         adv.summary AS summary, adv.publishedAt AS publishedAt, adv.simulated AS simulated,
         pkg.name AS packageName, pkg.version AS packageVersion,
         affects.patchedIn AS patchedIn,
         length(route) AS hops,
         declaredOnly,
         [n IN nodes(route) | {
           kind: CASE WHEN n:Application THEN 'application' ELSE 'package' END,
           id: coalesce(n.id, n.name),
           label: n.name
         }] AS route
       ORDER BY declaredOnly ASC,
         CASE adv.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END ASC,
         hops ASC, adv.cvss DESC`,
      { id },
    ),
  ]);

  return {
    ...app,
    installedPackages: counts?.installedPackages ?? 0,
    declaredOnlyPackages: counts?.declaredOnlyPackages ?? 0,
    directDependencies,
    findings,
  };
}

export type TeamExposure = {
  team: string;
  applications: number;
  critical: number;
  high: number;
  moderate: number;
  low: number;
};

/**
 * Exposure rolled up by owning team — the view an engineering manager wants.
 *
 * Derived from `getApplicationExposure` rather than queried separately. As
 * Cypher it was a second five-hop traversal over the whole graph to re-derive
 * numbers the dashboard had already fetched, and it measured at 4.4 seconds on
 * a free-tier instance. Grouping thirty rows in memory is free, and it also
 * guarantees the two panels can never disagree — which they could if one query
 * were changed and the other were not.
 */
export function rollUpByTeam(rows: ApplicationExposure[]): TeamExposure[] {
  const teams = new Map<string, TeamExposure>();

  for (const row of rows) {
    const existing = teams.get(row.team) ?? {
      team: row.team,
      applications: 0,
      critical: 0,
      high: 0,
      moderate: 0,
      low: 0,
    };
    existing.applications += 1;
    existing.critical += row.critical;
    existing.high += row.high;
    existing.moderate += row.moderate;
    existing.low += row.low;
    teams.set(row.team, existing);
  }

  return [...teams.values()].sort(
    (a, b) => b.critical - a.critical || b.high - a.high || a.team.localeCompare(b.team),
  );
}

export type ApplicationOption = { id: string; name: string; criticality: Criticality };

export async function listApplicationOptions(): Promise<ApplicationOption[]> {
  return runQuery<ApplicationOption>(
    `MATCH (app:Application)
     RETURN app.id AS id, app.name AS name, app.criticality AS criticality
     ORDER BY app.name ASC`,
  );
}
