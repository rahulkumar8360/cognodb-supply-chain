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

  const [counts, directDependencies, installedFindings, declaredOnlyFindings] = await Promise.all([
    runQuerySingle<{ installedPackages: number; declaredOnlyPackages: number }>(
      `MATCH (:Application { id: $id })-[r:REACHES]->(pkg:Package)
       RETURN count(CASE WHEN r.installed THEN pkg END) AS installedPackages,
              count(CASE WHEN NOT r.installed THEN pkg END) AS declaredOnlyPackages`,
      { id },
    ),
    runQuery<ApplicationDirectDependency>(
      `MATCH (:Application { id: $id })-[dep:DEPENDS_ON|DEPENDS_ON_DEV]->(pkg:Package)
       OPTIONAL MATCH (pkg)-[:DEPENDS_ON*1..3]->(behind:Package)
       WITH pkg, dep, count(DISTINCT behind) AS transitivePackages
       OPTIONAL MATCH (pkg)<-[:AFFECTS]-(adv:Advisory)
       RETURN pkg.name AS name, pkg.version AS version, dep.versionRange AS versionRange,
              dep.scope AS scope, pkg.weeklyDownloads AS weeklyDownloads,
              transitivePackages, count(DISTINCT adv) AS advisories
       ORDER BY advisories DESC, transitivePackages DESC, pkg.name ASC`,
      { id },
    ),
    // Split on installed vs declared-only for the same reason as the blast
    // radius: a finding that ships has no use for a dev-inclusive route, so
    // asking for both in one query computes a shortestPath that is discarded.
    runQuery<ApplicationFinding>(FINDINGS_INSTALLED, { id }),
    runQuery<ApplicationFinding>(FINDINGS_DECLARED_ONLY, { id }),
  ]);

  const severityRank: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3 };
  const findings = [...installedFindings, ...declaredOnlyFindings].sort(
    (a, b) =>
      Number(a.declaredOnly) - Number(b.declaredOnly) ||
      severityRank[a.severity] - severityRank[b.severity] ||
      a.hops - b.hops ||
      b.cvss - a.cvss,
  );

  return {
    ...app,
    installedPackages: counts?.installedPackages ?? 0,
    declaredOnlyPackages: counts?.declaredOnlyPackages ?? 0,
    directDependencies,
    findings,
  };
}

/** Shared tail of the two findings queries. Constant text, no interpolated values. */
const FINDINGS_PROJECTION = `
       RETURN
         adv.id AS id, adv.severity AS severity, adv.cvss AS cvss, adv.cwe AS cwe,
         adv.summary AS summary, adv.publishedAt AS publishedAt, adv.simulated AS simulated,
         pkg.name AS packageName, pkg.version AS packageVersion,
         affects.patchedIn AS patchedIn,
         reach.hops AS hops,
         NOT reach.installed AS declaredOnly,
         [n IN nodes(route) | {
           kind: CASE WHEN n:Application THEN 'application' ELSE 'package' END,
           id: coalesce(n.id, n.name),
           label: n.name
         }] AS route`;

const FINDINGS_INSTALLED = `
       MATCH (app:Application { id: $id })-[reach:REACHES { installed: true }]->(pkg:Package)
             <-[affects:AFFECTS]-(adv:Advisory)
       MATCH path = shortestPath((app)-[:DEPENDS_ON*1..5]->(pkg))
       WITH pkg, affects, adv, reach, collect(path)[0] AS route
       ${FINDINGS_PROJECTION}`;

const FINDINGS_DECLARED_ONLY = `
       MATCH (app:Application { id: $id })-[reach:REACHES { installed: false }]->(pkg:Package)
             <-[affects:AFFECTS]-(adv:Advisory)
       MATCH path = shortestPath((app)-[:DEPENDS_ON|DEPENDS_ON_OPTIONAL|DEPENDS_ON_DEV*1..5]->(pkg))
       WITH pkg, affects, adv, reach, collect(path)[0] AS route
       ${FINDINGS_PROJECTION}`;

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
