/**
 * Every Cypher query in the application lives under this directory, one module
 * per area of the graph. Nothing else in the codebase talks to the driver.
 *
 * The rules that apply to all of them:
 *
 *   - Query text is a constant. Values are always `$parameters`, so the server
 *     caches one plan per query and Cypher injection is not possible.
 *   - Filters that may be absent are expressed inside the query
 *     (`$search = '' OR ...`) rather than by building a different string.
 *   - Traversals name relationship *types* instead of filtering on a scope
 *     property, which keeps the planner's pruning expansion available.
 *   - Anything that can fail throws a `DatabaseError` from `runQuery`, which
 *     the UI renders as a state rather than a crash.
 */

export * from "./types";
export * from "./overview";
export * from "./applications";
export * from "./packages";
export * from "./advisories";
export * from "./risk";
export * from "./paths";
