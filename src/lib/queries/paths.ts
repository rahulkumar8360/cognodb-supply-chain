import { runQuery, runQuerySingle } from "../neo4j";

import type { RouteStep } from "./types";

export type DependencyRoute = {
  hops: number;
  steps: RouteStep[];
  /** One entry per hop: DEPENDS_ON, DEPENDS_ON_OPTIONAL or DEPENDS_ON_DEV. */
  edgeTypes: string[];
  /** True when every hop is a runtime dependency, so the package really is installed. */
  installed: boolean;
};

export type RouteResult = {
  application: { id: string; name: string; criticality: string };
  package: { name: string; version: string; description: string };
  routes: DependencyRoute[];
  /** Total distinct routes within the depth limit, which may exceed the returned sample. */
  shortestHops: number | null;
};

/**
 * "Why is this package in my build?"
 *
 * `allShortestPaths` answers it properly: not one route but *every* shortest
 * route, which is what you need when the honest answer is "three different
 * direct dependencies all pull it in and removing one changes nothing".
 *
 * Anyone who has tried to answer this from a dependency table in Postgres has
 * written the recursive CTE, watched it return a connected/not-connected
 * boolean, and then written a second query to reconstruct the route. Here the
 * route *is* the result.
 */
export async function findRoutes(
  applicationId: string,
  packageName: string,
  limit: number,
): Promise<RouteResult | null> {
  const endpoints = await runQuerySingle<{
    application: { id: string; name: string; criticality: string };
    package: { name: string; version: string; description: string };
  }>(
    `MATCH (app:Application { id: $applicationId })
     MATCH (pkg:Package { name: $packageName })
     RETURN { id: app.id, name: app.name, criticality: app.criticality } AS application,
            { name: pkg.name, version: pkg.version, description: pkg.description } AS package`,
    { applicationId, packageName },
  );

  if (!endpoints) return null;

  const routes = await runQuery<DependencyRoute>(
    `MATCH (app:Application { id: $applicationId })
     MATCH (pkg:Package { name: $packageName })
     MATCH route = allShortestPaths((app)-[:DEPENDS_ON|DEPENDS_ON_OPTIONAL|DEPENDS_ON_DEV*1..6]->(pkg))
     WITH route, [r IN relationships(route) | type(r)] AS edgeTypes
     RETURN
       length(route) AS hops,
       edgeTypes,
       all(t IN edgeTypes WHERE t = 'DEPENDS_ON') AS installed,
       [n IN nodes(route) | {
         kind: CASE WHEN n:Application THEN 'application' ELSE 'package' END,
         id: coalesce(n.id, n.name),
         label: n.name
       }] AS steps
     ORDER BY installed DESC, hops ASC
     LIMIT $limit`,
    { applicationId, packageName, limit },
  );

  return {
    ...endpoints,
    routes,
    shortestHops: routes.length > 0 ? Math.min(...routes.map((route) => route.hops)) : null,
  };
}

export type GraphNode = {
  id: string;
  label: string;
  kind: "application" | "package";
  /** Distance in hops from the focus node; drives the layout rings and colour ramp. */
  depth: number;
  weeklyDownloads: number;
  advisories: number;
  severity: string | null;
};

export type GraphEdge = { source: string; target: string; type: string };

export type Subgraph = { nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean };

const SUBGRAPH_NODE_LIMIT = 140;

/**
 * The neighbourhood around one package, for the force-directed view.
 *
 * Capped hard at two hops in each direction and 140 nodes. A dependency graph
 * has no natural boundary — two hops out from `debug` is most of the registry —
 * and a force layout with a thousand nodes is a hairball that tells the reader
 * nothing. The cap is a design decision, and the UI says so when it bites.
 */
export async function getPackageNeighbourhood(name: string): Promise<Subgraph> {
  type EdgeRow = {
    source: string;
    sourceLabel: string;
    sourceKind: "application" | "package";
    sourceDownloads: number;
    target: string;
    targetLabel: string;
    targetKind: "application" | "package";
    targetDownloads: number;
    type: string;
    sourceDepth: number;
    targetDepth: number;
  };

  // Three plain queries rather than one CALL subquery with UNION branches.
  // CognoDB is openCypher-compatible rather than Neo4j itself, and the subquery
  // forms are exactly where implementations diverge; MATCH, WITH and OPTIONAL
  // MATCH are the parts every engine agrees on. Three round trips against a
  // capped neighbourhood is a cheap price for not depending on that.
  // A shared constant fragment, not string-built Cypher: it contains no values
  // and does not vary with input. Every value in these queries still travels as
  // a `$parameter`, which is what keeps the plan cacheable and injection
  // impossible.
  const projection = `
     RETURN
       coalesce(source.id, source.name) AS source,
       source.name AS sourceLabel,
       CASE WHEN source:Application THEN 'application' ELSE 'package' END AS sourceKind,
       coalesce(source.weeklyDownloads, 0) AS sourceDownloads,
       coalesce(target.id, target.name) AS target,
       target.name AS targetLabel,
       CASE WHEN target:Application THEN 'application' ELSE 'package' END AS targetKind,
       coalesce(target.weeklyDownloads, 0) AS targetDownloads,
       type(edge) AS type,
       sourceDepth,
       targetDepth
     LIMIT $limit`;

  const [downOne, downTwo, up] = await Promise.all([
    runQuery<EdgeRow>(
      `MATCH (source:Package { name: $name })-[edge:DEPENDS_ON|DEPENDS_ON_OPTIONAL]->(target:Package)
       WITH source, target, edge, 0 AS sourceDepth, 1 AS targetDepth
       ${projection}`,
      { name, limit: SUBGRAPH_NODE_LIMIT },
    ),
    runQuery<EdgeRow>(
      `MATCH (:Package { name: $name })-[:DEPENDS_ON|DEPENDS_ON_OPTIONAL]->(source:Package)
             -[edge:DEPENDS_ON|DEPENDS_ON_OPTIONAL]->(target:Package)
       WITH source, target, edge, 1 AS sourceDepth, 2 AS targetDepth
       ${projection}`,
      { name, limit: SUBGRAPH_NODE_LIMIT },
    ),
    runQuery<EdgeRow>(
      `MATCH (source)-[edge:DEPENDS_ON|DEPENDS_ON_OPTIONAL|DEPENDS_ON_DEV]->(target:Package { name: $name })
       WHERE source:Package OR source:Application
       WITH source, target, edge, -1 AS sourceDepth, 0 AS targetDepth
       ${projection}`,
      { name, limit: SUBGRAPH_NODE_LIMIT },
    ),
  ]);

  const rows = [...downOne, ...downTwo, ...up];

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  const remember = (
    id: string,
    label: string,
    kind: "application" | "package",
    downloads: number,
    depth: number,
  ) => {
    const existing = nodes.get(id);
    if (existing) {
      // Keep the shallowest depth seen, so a node reachable both ways renders
      // at the ring closest to the focus.
      if (Math.abs(depth) < Math.abs(existing.depth)) existing.depth = depth;
      return;
    }
    nodes.set(id, { id, label, kind, depth, weeklyDownloads: downloads, advisories: 0, severity: null });
  };

  for (const row of rows) {
    remember(row.source, row.sourceLabel, row.sourceKind, row.sourceDownloads, row.sourceDepth);
    remember(row.target, row.targetLabel, row.targetKind, row.targetDownloads, row.targetDepth);
    edges.push({ source: row.source, target: row.target, type: row.type });
  }

  const truncated = nodes.size > SUBGRAPH_NODE_LIMIT;
  if (truncated) {
    // Drop the outermost, least-connected nodes first — the ones a reader is
    // least likely to be looking for.
    const degree = new Map<string, number>();
    for (const edge of edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }
    const keep = new Set(
      [...nodes.values()]
        .sort(
          (a, b) =>
            Math.abs(a.depth) - Math.abs(b.depth) ||
            (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0),
        )
        .slice(0, SUBGRAPH_NODE_LIMIT)
        .map((node) => node.id),
    );
    for (const id of [...nodes.keys()]) if (!keep.has(id)) nodes.delete(id);
    return {
      nodes: [...nodes.values()],
      edges: edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target)),
      truncated: true,
    };
  }

  // Annotate the surviving packages with their advisory state in one round trip.
  const names = [...nodes.values()].filter((node) => node.kind === "package").map((node) => node.label);
  if (names.length > 0) {
    const advisories = await runQuery<{ name: string; advisories: number; severity: string | null }>(
      `MATCH (pkg:Package)<-[:AFFECTS]-(adv:Advisory)
       WHERE pkg.name IN $names
       WITH pkg, collect(adv) AS advisories
       RETURN pkg.name AS name, size(advisories) AS advisories,
         CASE
           WHEN any(a IN advisories WHERE a.severity = 'critical') THEN 'critical'
           WHEN any(a IN advisories WHERE a.severity = 'high') THEN 'high'
           WHEN any(a IN advisories WHERE a.severity = 'moderate') THEN 'moderate'
           ELSE 'low'
         END AS severity`,
      { names },
    );
    for (const row of advisories) {
      const node = nodes.get(row.name);
      if (node) {
        node.advisories = row.advisories;
        node.severity = row.severity;
      }
    }
  }

  return { nodes: [...nodes.values()], edges, truncated: false };
}
