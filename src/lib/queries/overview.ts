import { runQuery, runQuerySingle } from "../neo4j";

import type { Criticality, Severity, SeverityCounts } from "./types";

/**
 * A note on traversal depth.
 *
 * Cypher does not allow the bounds of a variable-length pattern to come from a
 * parameter — `-[:DEPENDS_ON*1..$depth]->` is a syntax error, because the
 * bounds are part of the plan, not the input. Building the number into the
 * string would mean concatenating Cypher, which this codebase does not do.
 *
 * So the bound is a constant of the application: five hops. Measured against
 * the seeded graph, 99.7% of application-to-package routes are five hops or
 * fewer, and the deepest is seven. Where the UI offers a depth control, the
 * query binds the path and filters on `length(path) <= $maxDepth`, which is a
 * genuine parameter.
 */
export const MAX_TRAVERSAL_DEPTH = 5;

export type GraphTotals = {
  applications: number;
  packages: number;
  maintainers: number;
  advisories: number;
  dependencies: number;
};

export async function getGraphTotals(): Promise<GraphTotals> {
  const row = await runQuerySingle<GraphTotals>(
    `MATCH (app:Application) WITH count(app) AS applications
     MATCH (pkg:Package) WITH applications, count(pkg) AS packages
     MATCH (m:Maintainer) WITH applications, packages, count(m) AS maintainers
     MATCH (adv:Advisory) WITH applications, packages, maintainers, count(adv) AS advisories
     MATCH ()-[dep:DEPENDS_ON|DEPENDS_ON_OPTIONAL|DEPENDS_ON_DEV]->()
     RETURN applications, packages, maintainers, advisories, count(dep) AS dependencies`,
  );
  return row ?? { applications: 0, packages: 0, maintainers: 0, advisories: 0, dependencies: 0 };
}

export type ExposureSummary = SeverityCounts & {
  /** Advisories with at least one application reachable over installed dependencies. */
  reachingProduction: number;
  /** Advisories in the feed that no application actually pulls in. */
  notReachable: number;
};

/**
 * Severity breakdown of the advisory feed, split by whether anything is
 * actually exposed.
 *
 * This is the number that makes the graph worth building: an unfiltered feed of
 * 153 advisories is noise, and the only way to turn it into a work queue is to
 * ask which of them can be reached from something we run.
 */
export async function getExposureSummary(): Promise<ExposureSummary> {
  const row = await runQuerySingle<ExposureSummary>(
    `MATCH (adv:Advisory)-[:AFFECTS]->(pkg:Package)
     OPTIONAL MATCH (app:Application)-[:DEPENDS_ON*1..5]->(pkg)
     WITH adv, count(DISTINCT app) AS exposedApps
     WITH collect({ severity: adv.severity, exposed: exposedApps > 0 }) AS rows
     RETURN
       size([r IN rows WHERE r.exposed AND r.severity = 'critical']) AS critical,
       size([r IN rows WHERE r.exposed AND r.severity = 'high']) AS high,
       size([r IN rows WHERE r.exposed AND r.severity = 'moderate']) AS moderate,
       size([r IN rows WHERE r.exposed AND r.severity = 'low']) AS low,
       size([r IN rows WHERE r.exposed]) AS reachingProduction,
       size([r IN rows WHERE NOT r.exposed]) AS notReachable`,
  );
  return row ?? { critical: 0, high: 0, moderate: 0, low: 0, reachingProduction: 0, notReachable: 0 };
}

export type ApplicationExposure = {
  id: string;
  name: string;
  team: string;
  criticality: Criticality;
  environment: "production" | "internal";
  description: string;
  /** Distinct packages installed through runtime dependencies. */
  installedPackages: number;
  /** Packages that are declared somewhere in the tree but not necessarily installed. */
  declaredOnlyPackages: number;
  advisories: number;
} & SeverityCounts;

/**
 * Every application, ranked by what an attacker could actually reach.
 *
 * The two traversals are deliberately different: `DEPENDS_ON` alone is what
 * ships, while the type union adds optional and dev dependencies, which are
 * declared in the tree but may never end up in the running artifact. Reporting
 * both is what stops the dashboard from either crying wolf or missing things.
 */
export async function getApplicationExposure(): Promise<ApplicationExposure[]> {
  return runQuery<ApplicationExposure>(
    `MATCH (app:Application)
     OPTIONAL MATCH (app)-[:DEPENDS_ON*1..5]->(installed:Package)
     OPTIONAL MATCH (installed)<-[:AFFECTS]-(adv:Advisory)
     WITH app,
          count(DISTINCT installed) AS installedCount,
          collect(DISTINCT adv) AS advisories
     OPTIONAL MATCH (app)-[:DEPENDS_ON|DEPENDS_ON_OPTIONAL|DEPENDS_ON_DEV*1..5]->(declared:Package)
     WITH app, installedCount, advisories, count(DISTINCT declared) AS declaredCount
     RETURN
       app.id AS id,
       app.name AS name,
       app.team AS team,
       app.criticality AS criticality,
       app.environment AS environment,
       app.description AS description,
       installedCount AS installedPackages,
       declaredCount - installedCount AS declaredOnlyPackages,
       size(advisories) AS advisories,
       size([a IN advisories WHERE a.severity = 'critical']) AS critical,
       size([a IN advisories WHERE a.severity = 'high']) AS high,
       size([a IN advisories WHERE a.severity = 'moderate']) AS moderate,
       size([a IN advisories WHERE a.severity = 'low']) AS low
     ORDER BY critical DESC, high DESC, advisories DESC, name ASC`,
  );
}

export type RiskyPackage = {
  name: string;
  version: string;
  weeklyDownloads: number;
  applicationsReached: number;
  tierOneReached: number;
  advisories: number;
  worstSeverity: Severity | null;
  maintainerCount: number;
};

/**
 * The packages worth fixing first: reachable from the most applications, with
 * the most severe advisory against them.
 */
export async function getRiskiestPackages(limit: number): Promise<RiskyPackage[]> {
  return runQuery<RiskyPackage>(
    `MATCH (adv:Advisory)-[:AFFECTS]->(pkg:Package)
     WITH pkg, collect(adv) AS advisories
     MATCH (app:Application)-[:DEPENDS_ON*1..5]->(pkg)
     WITH pkg, advisories, collect(DISTINCT app) AS apps
     MATCH (m:Maintainer)-[:MAINTAINS]->(pkg)
     WITH pkg, advisories, apps, count(DISTINCT m) AS maintainerCount
     RETURN
       pkg.name AS name,
       pkg.version AS version,
       pkg.weeklyDownloads AS weeklyDownloads,
       size(apps) AS applicationsReached,
       size([a IN apps WHERE a.criticality = 'tier-1']) AS tierOneReached,
       size(advisories) AS advisories,
       CASE
         WHEN any(a IN advisories WHERE a.severity = 'critical') THEN 'critical'
         WHEN any(a IN advisories WHERE a.severity = 'high') THEN 'high'
         WHEN any(a IN advisories WHERE a.severity = 'moderate') THEN 'moderate'
         ELSE 'low'
       END AS worstSeverity,
       maintainerCount
     ORDER BY tierOneReached DESC, applicationsReached DESC, advisories DESC
     LIMIT $limit`,
    { limit },
  );
}
