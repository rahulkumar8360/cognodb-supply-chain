import { runQuery } from "../neo4j";

import type { LicenseCategory } from "./types";

export type Chokepoint = {
  packageName: string;
  version: string;
  weeklyDownloads: number;
  lastPublished: string;
  deprecated: boolean;
  maintainerUsername: string;
  maintainerName: string;
  twoFactorEnabled: boolean;
  daysSinceLastPublish: number;
  /** Other packages the same account controls. */
  alsoMaintains: number;
  applicationsReached: number;
  tierOneReached: number;
  shortestHops: number;
};

/**
 * Bus-factor-one packages, ranked by how much they hold up.
 *
 * The finding is "a single person can push code into N of our applications, and
 * we have never spoken to them". event-stream, ua-parser-js and node-ipc were
 * all exactly this shape before they became incidents.
 *
 * The query order matters for cost. Expanding out from the 30 applications once
 * gives every package's reach in a single pruned traversal; the maintainer
 * filter is then a cheap join on the survivors. Written the other way round —
 * find single-maintainer packages first, then traverse from each — it would run
 * one traversal per package, which on a burstable free-tier instance is the
 * difference between a fast page and a timeout.
 */
export async function getChokepoints(minApplications: number, limit: number): Promise<Chokepoint[]> {
  return runQuery<Chokepoint>(
    `MATCH (app:Application)-[:DEPENDS_ON*1..5]->(pkg:Package)
     WITH pkg, collect(DISTINCT app) AS apps
     WHERE size(apps) >= $minApplications
     MATCH (pkg)<-[:MAINTAINS]-(m:Maintainer)
     WITH pkg, apps, collect(m) AS maintainers
     WHERE size(maintainers) = 1
     WITH pkg, apps, maintainers[0] AS solo
     MATCH (solo)-[:MAINTAINS]->(other:Package)
     WITH pkg, apps, solo, count(DISTINCT other) AS alsoMaintains
     MATCH route = shortestPath((:Application)-[:DEPENDS_ON*1..5]->(pkg))
     WITH pkg, apps, solo, alsoMaintains, min(length(route)) AS shortestHops
     RETURN
       pkg.name AS packageName,
       pkg.version AS version,
       pkg.weeklyDownloads AS weeklyDownloads,
       pkg.lastPublished AS lastPublished,
       pkg.deprecated AS deprecated,
       solo.username AS maintainerUsername,
       solo.name AS maintainerName,
       solo.twoFactorEnabled AS twoFactorEnabled,
       solo.daysSinceLastPublish AS daysSinceLastPublish,
       alsoMaintains - 1 AS alsoMaintains,
       size(apps) AS applicationsReached,
       size([a IN apps WHERE a.criticality = 'tier-1']) AS tierOneReached,
       shortestHops
     ORDER BY tierOneReached DESC, applicationsReached DESC, twoFactorEnabled ASC, pkg.name ASC
     LIMIT $limit`,
    { minApplications, limit },
  );
}

export type TakeoverRisk = {
  username: string;
  name: string;
  joinedAt: string;
  twoFactorEnabled: boolean;
  daysSinceLastPublish: number;
  packagesOwned: number;
  packagesReachable: number;
  applicationsReached: number;
  tierOneReached: number;
  topPackages: string[];
};

/**
 * If this account were compromised tomorrow, what would we have to rebuild?
 *
 * This is a two-hop question with an aggregation in the middle — maintainer to
 * package to (transitively) application — and the answer is a set union across
 * every package the account touches. The account that matters is rarely the one
 * with the most packages; it is the one whose packages sit underneath the most
 * tier-1 services, which is only visible after the traversal.
 */
export async function getTakeoverRisk(options: { requireNo2FA: boolean; limit: number }): Promise<TakeoverRisk[]> {
  return runQuery<TakeoverRisk>(
    `MATCH (app:Application)-[:DEPENDS_ON*1..5]->(pkg:Package)
     WITH pkg, collect(DISTINCT app) AS apps
     MATCH (m:Maintainer)-[:MAINTAINS]->(pkg)
     WHERE NOT $requireNo2FA OR m.twoFactorEnabled = false
     WITH m, pkg, apps
     ORDER BY size(apps) DESC, pkg.weeklyDownloads DESC
     WITH m,
          count(DISTINCT pkg) AS packagesReachable,
          collect(pkg.name)[0..4] AS topPackages,
          reduce(all = [], list IN collect(apps) | all + list) AS reachedApps
     UNWIND reachedApps AS app
     WITH m, packagesReachable, topPackages, collect(DISTINCT app) AS apps
     MATCH (m)-[:MAINTAINS]->(owned:Package)
     WITH m, packagesReachable, topPackages, apps, count(DISTINCT owned) AS packagesOwned
     RETURN
       m.username AS username,
       m.name AS name,
       m.joinedAt AS joinedAt,
       m.twoFactorEnabled AS twoFactorEnabled,
       m.daysSinceLastPublish AS daysSinceLastPublish,
       packagesOwned,
       packagesReachable,
       size(apps) AS applicationsReached,
       size([a IN apps WHERE a.criticality = 'tier-1']) AS tierOneReached,
       topPackages
     ORDER BY tierOneReached DESC, applicationsReached DESC, packagesReachable DESC
     LIMIT $limit`,
    options,
  );
}

export type LicenseExposure = {
  licenseId: string;
  licenseName: string;
  category: LicenseCategory;
  packageName: string;
  packageVersion: string;
  applicationsReached: number;
  tierOneReached: number;
  shortestHops: number;
  exampleRoute: string[];
};

/**
 * Copyleft and source-available code that reaches production over installed
 * dependencies.
 *
 * Traversing `DEPENDS_ON` only is the whole point: a GPL package pulled in as a
 * build tool carries no distribution obligation, while the same package four
 * levels down a runtime tree very much does. The distinction is a property of
 * the *path*, not of either endpoint — which is why the relationship type
 * carries the scope, and why this is a single traversal rather than a recursive
 * CTE with a predicate on every level.
 */
export async function getLicenseExposure(categories: LicenseCategory[], limit: number): Promise<LicenseExposure[]> {
  return runQuery<LicenseExposure>(
    `MATCH (pkg:Package)-[:LICENSED_UNDER]->(lic:License)
     WHERE lic.category IN $categories
     MATCH (app:Application)-[:DEPENDS_ON*1..5]->(pkg)
     WITH lic, pkg, collect(DISTINCT app) AS apps
     MATCH route = shortestPath((source:Application)-[:DEPENDS_ON*1..5]->(pkg))
     WITH lic, pkg, apps, route
     ORDER BY length(route) ASC
     WITH lic, pkg, apps, collect(route)[0] AS shortestRoute
     RETURN
       lic.id AS licenseId,
       lic.name AS licenseName,
       lic.category AS category,
       pkg.name AS packageName,
       pkg.version AS packageVersion,
       size(apps) AS applicationsReached,
       size([a IN apps WHERE a.criticality = 'tier-1']) AS tierOneReached,
       length(shortestRoute) AS shortestHops,
       [n IN nodes(shortestRoute) | n.name] AS exampleRoute
     ORDER BY tierOneReached DESC, applicationsReached DESC, pkg.name ASC
     LIMIT $limit`,
    { categories, limit },
  );
}

export type PhantomDependency = {
  applicationId: string;
  applicationName: string;
  criticality: string;
  packageName: string;
  packageVersion: string;
  declaredHops: number;
  advisories: number;
  worstSeverity: string | null;
};

/**
 * Packages that appear in an application's dependency tree but are not
 * necessarily installed — every route to them runs through an optional or dev
 * dependency.
 *
 * This is the query that is genuinely awkward anywhere else: it is a set
 * difference between two transitive closures over the same nodes but different
 * edge types. In SQL it is two recursive CTEs and a NOT EXISTS against the
 * second, re-evaluated per application. Here it is one traversal, one
 * `shortestPath` existence check, and a null test.
 *
 * It matters because a scanner that ignores the distinction will page someone
 * at 3am about a critical vulnerability in a package that was never shipped.
 */
export async function getPhantomDependencies(limit: number): Promise<PhantomDependency[]> {
  return runQuery<PhantomDependency>(
    `MATCH (app:Application)-[:DEPENDS_ON|DEPENDS_ON_OPTIONAL|DEPENDS_ON_DEV*1..5]->(pkg:Package)
     WITH DISTINCT app, pkg
     MATCH (pkg)<-[:AFFECTS]-(adv:Advisory)
     WITH app, pkg, collect(adv) AS advisories
     OPTIONAL MATCH installed = shortestPath((app)-[:DEPENDS_ON*1..5]->(pkg))
     WITH app, pkg, advisories, installed
     WHERE installed IS NULL
     MATCH declared = shortestPath((app)-[:DEPENDS_ON|DEPENDS_ON_OPTIONAL|DEPENDS_ON_DEV*1..5]->(pkg))
     RETURN
       app.id AS applicationId,
       app.name AS applicationName,
       app.criticality AS criticality,
       pkg.name AS packageName,
       pkg.version AS packageVersion,
       length(declared) AS declaredHops,
       size(advisories) AS advisories,
       CASE
         WHEN any(a IN advisories WHERE a.severity = 'critical') THEN 'critical'
         WHEN any(a IN advisories WHERE a.severity = 'high') THEN 'high'
         WHEN any(a IN advisories WHERE a.severity = 'moderate') THEN 'moderate'
         ELSE 'low'
       END AS worstSeverity
     ORDER BY
       CASE worstSeverity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END ASC,
       app.criticality ASC,
       pkg.name ASC
     LIMIT $limit`,
    { limit },
  );
}
