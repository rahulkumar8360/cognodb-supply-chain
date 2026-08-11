import { runQuery, runQuerySingle } from "../neo4j";

import type { AdvisorySummary, Criticality, LicenseCategory, Severity } from "./types";

export type PackageListItem = {
  name: string;
  version: string;
  description: string;
  weeklyDownloads: number;
  license: string;
  deprecated: boolean;
  directDependents: number;
  maintainerCount: number;
  advisories: number;
  worstSeverity: Severity | null;
};

export type PackageFilter = {
  search: string;
  /** "" means no filter. */
  license: string;
  vulnerableOnly: boolean;
  singleMaintainerOnly: boolean;
  limit: number;
  offset: number;
};

export async function listPackages(filter: PackageFilter): Promise<PackageListItem[]> {
  return runQuery<PackageListItem>(
    `MATCH (pkg:Package)
     WHERE ($search = '' OR toLower(pkg.name) CONTAINS toLower($search))
       AND ($license = '' OR pkg.license = $license)
     OPTIONAL MATCH (pkg)<-[:MAINTAINS]-(m:Maintainer)
     WITH pkg, count(DISTINCT m) AS maintainerCount
     WHERE NOT $singleMaintainerOnly OR maintainerCount = 1
     OPTIONAL MATCH (pkg)<-[:AFFECTS]-(adv:Advisory)
     WITH pkg, maintainerCount, collect(DISTINCT adv) AS advisories
     WHERE NOT $vulnerableOnly OR size(advisories) > 0
     OPTIONAL MATCH (pkg)<-[:DEPENDS_ON|DEPENDS_ON_OPTIONAL|DEPENDS_ON_DEV]-(dependent)
     WITH pkg, maintainerCount, advisories, count(DISTINCT dependent) AS directDependents
     RETURN
       pkg.name AS name,
       pkg.version AS version,
       pkg.description AS description,
       pkg.weeklyDownloads AS weeklyDownloads,
       pkg.license AS license,
       pkg.deprecated AS deprecated,
       directDependents,
       maintainerCount,
       size(advisories) AS advisories,
       CASE
         WHEN size(advisories) = 0 THEN null
         WHEN any(a IN advisories WHERE a.severity = 'critical') THEN 'critical'
         WHEN any(a IN advisories WHERE a.severity = 'high') THEN 'high'
         WHEN any(a IN advisories WHERE a.severity = 'moderate') THEN 'moderate'
         ELSE 'low'
       END AS worstSeverity
     ORDER BY directDependents DESC, pkg.weeklyDownloads DESC, pkg.name ASC
     SKIP $offset LIMIT $limit`,
    filter,
  );
}

export async function countPackages(filter: Omit<PackageFilter, "limit" | "offset">): Promise<number> {
  const row = await runQuerySingle<{ total: number }>(
    `MATCH (pkg:Package)
     WHERE ($search = '' OR toLower(pkg.name) CONTAINS toLower($search))
       AND ($license = '' OR pkg.license = $license)
     OPTIONAL MATCH (pkg)<-[:MAINTAINS]-(m:Maintainer)
     WITH pkg, count(DISTINCT m) AS maintainerCount
     WHERE NOT $singleMaintainerOnly OR maintainerCount = 1
     OPTIONAL MATCH (pkg)<-[:AFFECTS]-(adv:Advisory)
     WITH pkg, count(DISTINCT adv) AS advisoryCount
     WHERE NOT $vulnerableOnly OR advisoryCount > 0
     RETURN count(pkg) AS total`,
    filter,
  );
  return row?.total ?? 0;
}

export type PackageNeighbour = {
  name: string;
  version: string;
  weeklyDownloads: number;
  /** How the edge is declared: runtime, optional or dev. */
  scope: string;
  versionRange: string;
  advisories: number;
};

export type PackageAdvisory = AdvisorySummary & { vulnerableRange: string; patchedIn: string };

export type PackageMaintainer = {
  username: string;
  name: string;
  role: string;
  since: string;
  twoFactorEnabled: boolean;
  packagesMaintained: number;
};

export type PackageDetail = {
  name: string;
  version: string;
  description: string;
  repoUrl: string;
  weeklyDownloads: number;
  lastPublished: string;
  deprecated: boolean;
  license: string;
  licenseName: string;
  licenseCategory: LicenseCategory;
  /** Distinct packages this one pulls in, at any depth, over installed edges. */
  transitiveDependencies: number;
  /** Distinct packages that reach this one, at any depth. */
  transitiveDependents: number;
  advisories: PackageAdvisory[];
  maintainers: PackageMaintainer[];
  dependencies: PackageNeighbour[];
  dependents: PackageNeighbour[];
  reachedByApplications: Array<{ id: string; name: string; criticality: Criticality; hops: number }>;
};

/**
 * Everything the package page needs.
 *
 * This runs as several small queries rather than one large one on purpose. A
 * single query would have to fan out across dependencies, dependents,
 * maintainers, advisories and applications at once, and Cypher's cardinality
 * would multiply through the join — the classic accidental cross-product that
 * makes one page load pull a million rows. Small queries also let the slow one
 * (the transitive counts) be the only thing that ever needs optimising.
 */
export async function getPackageDetail(name: string): Promise<PackageDetail | null> {
  const core = await runQuerySingle<{
    name: string;
    version: string;
    description: string;
    repoUrl: string;
    weeklyDownloads: number;
    lastPublished: string;
    deprecated: boolean;
    license: string;
    licenseName: string;
    licenseCategory: LicenseCategory;
  }>(
    `MATCH (pkg:Package { name: $name })
     OPTIONAL MATCH (pkg)-[:LICENSED_UNDER]->(lic:License)
     RETURN
       pkg.name AS name, pkg.version AS version, pkg.description AS description,
       pkg.repoUrl AS repoUrl, pkg.weeklyDownloads AS weeklyDownloads,
       pkg.lastPublished AS lastPublished, pkg.deprecated AS deprecated,
       pkg.license AS license,
       coalesce(lic.name, pkg.license) AS licenseName,
       coalesce(lic.category, 'permissive') AS licenseCategory`,
    { name },
  );

  if (!core) return null;

  const [reach, advisories, maintainers, dependencies, dependents, applications] = await Promise.all([
    runQuerySingle<{ transitiveDependencies: number; transitiveDependents: number }>(
      `MATCH (pkg:Package { name: $name })
       OPTIONAL MATCH (pkg)-[:DEPENDS_ON*1..5]->(down:Package)
       WITH pkg, count(DISTINCT down) AS transitiveDependencies
       OPTIONAL MATCH (up:Package)-[:DEPENDS_ON*1..5]->(pkg)
       RETURN transitiveDependencies, count(DISTINCT up) AS transitiveDependents`,
      { name },
    ),
    runQuery<PackageAdvisory>(
      `MATCH (adv:Advisory)-[affects:AFFECTS]->(:Package { name: $name })
       RETURN adv.id AS id, adv.severity AS severity, adv.cvss AS cvss, adv.cwe AS cwe,
              adv.summary AS summary, adv.publishedAt AS publishedAt, adv.simulated AS simulated,
              affects.vulnerableRange AS vulnerableRange, affects.patchedIn AS patchedIn
       ORDER BY adv.cvss DESC`,
      { name },
    ),
    runQuery<PackageMaintainer>(
      `MATCH (m:Maintainer)-[r:MAINTAINS]->(:Package { name: $name })
       OPTIONAL MATCH (m)-[:MAINTAINS]->(other:Package)
       RETURN m.username AS username, m.name AS name, r.role AS role, r.since AS since,
              m.twoFactorEnabled AS twoFactorEnabled, count(DISTINCT other) AS packagesMaintained
       ORDER BY r.role ASC, m.username ASC`,
      { name },
    ),
    runQuery<PackageNeighbour>(
      `MATCH (:Package { name: $name })-[dep:DEPENDS_ON|DEPENDS_ON_OPTIONAL]->(other:Package)
       OPTIONAL MATCH (other)<-[:AFFECTS]-(adv:Advisory)
       RETURN other.name AS name, other.version AS version, other.weeklyDownloads AS weeklyDownloads,
              dep.scope AS scope, dep.versionRange AS versionRange, count(DISTINCT adv) AS advisories
       ORDER BY advisories DESC, other.weeklyDownloads DESC`,
      { name },
    ),
    runQuery<PackageNeighbour>(
      `MATCH (other:Package)-[dep:DEPENDS_ON|DEPENDS_ON_OPTIONAL]->(:Package { name: $name })
       RETURN other.name AS name, other.version AS version, other.weeklyDownloads AS weeklyDownloads,
              dep.scope AS scope, dep.versionRange AS versionRange, 0 AS advisories
       ORDER BY other.weeklyDownloads DESC
       LIMIT 60`,
      { name },
    ),
    runQuery<{ id: string; name: string; criticality: Criticality; hops: number }>(
      `MATCH (pkg:Package { name: $name })
       MATCH (app:Application)-[:DEPENDS_ON*1..5]->(pkg)
       WITH DISTINCT app, pkg
       MATCH route = shortestPath((app)-[:DEPENDS_ON*1..5]->(pkg))
       RETURN app.id AS id, app.name AS name, app.criticality AS criticality, length(route) AS hops
       ORDER BY app.criticality ASC, hops ASC, app.name ASC`,
      { name },
    ),
  ]);

  return {
    ...core,
    transitiveDependencies: reach?.transitiveDependencies ?? 0,
    transitiveDependents: reach?.transitiveDependents ?? 0,
    advisories,
    maintainers,
    dependencies,
    dependents,
    reachedByApplications: applications,
  };
}

/** Type-ahead for the package pickers. Ordered by popularity so the obvious answer is first. */
export async function searchPackages(term: string, limit: number): Promise<Array<{ name: string; version: string; weeklyDownloads: number }>> {
  if (term.trim() === "") return [];
  return runQuery<{ name: string; version: string; weeklyDownloads: number }>(
    `MATCH (pkg:Package)
     WHERE toLower(pkg.name) CONTAINS toLower($term)
     RETURN pkg.name AS name, pkg.version AS version, pkg.weeklyDownloads AS weeklyDownloads
     ORDER BY
       CASE WHEN toLower(pkg.name) = toLower($term) THEN 0
            WHEN toLower(pkg.name) STARTS WITH toLower($term) THEN 1
            ELSE 2 END ASC,
       pkg.weeklyDownloads DESC
     LIMIT $limit`,
    { term, limit },
  );
}

export async function listLicenses(): Promise<Array<{ id: string; name: string; category: LicenseCategory; packages: number }>> {
  return runQuery<{ id: string; name: string; category: LicenseCategory; packages: number }>(
    `MATCH (lic:License)<-[:LICENSED_UNDER]-(pkg:Package)
     RETURN lic.id AS id, lic.name AS name, lic.category AS category, count(pkg) AS packages
     ORDER BY packages DESC`,
  );
}
