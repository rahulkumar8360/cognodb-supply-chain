/**
 * Deterministic generator for the demo dataset.
 *
 * The graph is a simulation of one company's dependency surface:
 *
 *   - a curated core of ~170 real npm packages with their real dependency
 *     edges (see `data/core-packages.ts`),
 *   - a generated long tail of single-purpose utilities layered underneath,
 *     wired up with preferential attachment so that download counts and
 *     dependent counts follow the power law the real registry does,
 *   - the maintainers behind those packages, most of whom look after exactly
 *     one thing,
 *   - published advisories, and
 *   - the internal applications at a fictional company, Meridian Logistics.
 *
 * Everything is driven by a fixed seed, so `npm run seed` produces byte-identical
 * data on every machine — which matters when the README quotes numbers and the
 * screenshots need to match what a reviewer sees.
 */

import { CORE_ADVISORIES, CoreAdvisoryRow, Severity } from "./data/core-advisories";
import { CORE_PACKAGES } from "./data/core-packages";

// --------------------------------------------------------------- the model --

export type LicenseNode = {
  id: string; // SPDX identifier
  name: string;
  /** Drives the "copyleft reached a runtime path" report. */
  category: "permissive" | "weak-copyleft" | "strong-copyleft" | "source-available";
};

export type PackageNode = {
  name: string;
  ecosystem: "npm";
  version: string;
  description: string;
  repoUrl: string;
  weeklyDownloads: number;
  lastPublished: string;
  deprecated: boolean;
  license: string;
  /** Depth in the dependency DAG; 0 means the package has no dependencies. */
  layer: number;
};

export type MaintainerNode = {
  username: string;
  name: string;
  joinedAt: string;
  twoFactorEnabled: boolean;
  /** Days since the account last published anything. Stale accounts are takeover bait. */
  daysSinceLastPublish: number;
};

export type ApplicationNode = {
  id: string;
  name: string;
  team: string;
  criticality: "tier-1" | "tier-2" | "tier-3";
  description: string;
  environment: "production" | "internal";
};

export type AdvisoryNode = {
  id: string;
  severity: Severity;
  cvss: number;
  cwe: string;
  summary: string;
  publishedAt: string;
  /** Real advisories are modelled on public records; the long tail is simulated. */
  simulated: boolean;
};

export type PackageDependency = {
  from: string;
  to: string;
  /** `optional` edges are declared as optionalDependencies and may not be installed. */
  scope: "runtime" | "optional";
  versionRange: string;
};

export type ApplicationDependency = {
  from: string; // application id
  to: string; // package name
  scope: "runtime" | "dev";
  versionRange: string;
};

/**
 * A materialised transitive closure: this application can reach this package.
 *
 * The dependency edges are the source of truth and every route shown in the UI
 * is still traversed live. This is a derived index on top of them, rebuilt from
 * scratch by the loader.
 *
 * It exists because CognoDB's planner does not appear to prune variable-length
 * expansions the way Neo4j's does. Measured on the free (c0) tier, one
 * `(app)-[:DEPENDS_ON*1..5]->(pkg)` walk from all thirty applications costs
 * ~4.3 seconds, and the dashboard needs three of them — a fourteen-second page.
 * Against this same graph in Neo4j the identical query is 136 ms, so the cost
 * is the engine's expansion strategy rather than the model or the data volume.
 *
 * Reachability changes only when someone merges a dependency change, so it is
 * exactly the kind of thing worth precomputing. The queries that *explain* a
 * result — blast-radius routes, path tracing, the neighbourhood graph — stay
 * live, because those are scoped to a single package and are fast.
 */
export type Reaches = {
  applicationId: string;
  packageName: string;
  /** True when a path exists using runtime dependencies only, i.e. it really ships. */
  installed: boolean;
  /** Shortest hop count over the edges that apply: runtime-only when installed, otherwise any. */
  hops: number;
  /** Shortest hop count following optional and dev edges too. */
  declaredHops: number;
};

export type Maintains = { username: string; packageName: string; since: string; role: "owner" | "collaborator" };
export type Affects = { advisoryId: string; packageName: string; vulnerableRange: string; patchedIn: string };
export type LicensedUnder = { packageName: string; licenseId: string };

export type Dataset = {
  licenses: LicenseNode[];
  packages: PackageNode[];
  maintainers: MaintainerNode[];
  applications: ApplicationNode[];
  advisories: AdvisoryNode[];
  packageDependencies: PackageDependency[];
  applicationDependencies: ApplicationDependency[];
  maintains: Maintains[];
  affects: Affects[];
  licensedUnder: LicensedUnder[];
  reaches: Reaches[];
};

/** Traversal depth the closure is built to. Must match the bound used in the live queries. */
export const REACH_DEPTH = 5;

// --------------------------------------------------------------- utilities --

/** mulberry32 — small, fast, and identical across platforms, so the seed is reproducible. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  return function random(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0x5c4d1a;
const random = createRandom(SEED);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

function pickWeighted<T>(items: readonly T[], weight: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let threshold = random() * total;
  for (const item of items) {
    threshold -= weight(item);
    if (threshold <= 0) return item;
  }
  return items[items.length - 1];
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function chance(probability: number): boolean {
  return random() < probability;
}

/** A date `daysAgo` before the fixed "today" the dataset is anchored to. */
const TODAY = Date.UTC(2026, 7, 12); // 2026-08-12
function dateDaysAgo(daysAgo: number): string {
  return new Date(TODAY - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- licenses --

const LICENSES: LicenseNode[] = [
  { id: "MIT", name: "MIT License", category: "permissive" },
  { id: "ISC", name: "ISC License", category: "permissive" },
  { id: "Apache-2.0", name: "Apache License 2.0", category: "permissive" },
  { id: "BSD-2-Clause", name: "BSD 2-Clause License", category: "permissive" },
  { id: "BSD-3-Clause", name: "BSD 3-Clause License", category: "permissive" },
  { id: "CC-BY-4.0", name: "Creative Commons Attribution 4.0", category: "permissive" },
  { id: "Python-2.0", name: "Python License 2.0", category: "permissive" },
  { id: "MPL-2.0", name: "Mozilla Public License 2.0", category: "weak-copyleft" },
  { id: "LGPL-3.0", name: "GNU Lesser General Public License v3.0", category: "weak-copyleft" },
  { id: "GPL-3.0", name: "GNU General Public License v3.0", category: "strong-copyleft" },
  { id: "AGPL-3.0", name: "GNU Affero General Public License v3.0", category: "strong-copyleft" },
  { id: "BUSL-1.1", name: "Business Source License 1.1", category: "source-available" },
];

/**
 * The long tail's licence mix. Overwhelmingly permissive, with just enough
 * copyleft to make the compliance report find something real — which is exactly
 * how the registry looks, and exactly why the report is worth running.
 */
const TAIL_LICENSE_WEIGHTS: Array<[string, number]> = [
  ["MIT", 720],
  ["ISC", 120],
  ["Apache-2.0", 90],
  ["BSD-3-Clause", 30],
  ["BSD-2-Clause", 20],
  ["MPL-2.0", 13],
  ["LGPL-3.0", 11],
  ["GPL-3.0", 9],
  ["AGPL-3.0", 6],
  ["BUSL-1.1", 4],
];

// ------------------------------------------------------- name construction --

const TAIL_PREFIXES = [
  "fast", "tiny", "micro", "simple", "safe", "deep", "flat", "lazy", "eager", "strict",
  "async", "sync", "quick", "plain", "smart", "auto", "multi", "cross", "inline", "pure",
  "nano", "mini", "super", "ultra", "hyper", "meta", "proto", "raw", "typed", "lite",
];

const TAIL_ROOTS = [
  "buffer", "stream", "parser", "matcher", "walker", "resolver", "loader", "logger", "cache",
  "queue", "emitter", "signal", "watcher", "reader", "writer", "encoder", "decoder", "hasher",
  "serializer", "validator", "formatter", "sanitizer", "template", "tokenizer", "scheduler",
  "throttle", "debounce", "retry", "backoff", "cursor", "iterator", "clone", "merge", "diff",
  "patch", "glob", "path", "uri", "slug", "uuid", "color", "date", "time", "money", "unit",
  "regex", "ansi", "table", "tree", "graph", "list", "map", "set", "pool", "lock", "mutex",
  "config", "env", "flag", "argv", "prompt", "spinner", "progress", "banner", "chalk", "yaml",
  "toml", "csv", "xml", "html", "css", "sourcemap", "bundle", "chunk", "minify", "polyfill",
];

const TAIL_SUFFIXES = ["", "", "", "", "-js", "-lite", "-x", "2", "-utils", "-core", "-kit", "-fn", "-es"];

const SCOPES = ["@meridian", "@stdlib-js", "@nodekit", "@toolbelt", "@webio"];

function makePackageName(taken: Set<string>): string {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const scoped = chance(0.14);
    const body = chance(0.45)
      ? `${pick(TAIL_PREFIXES)}-${pick(TAIL_ROOTS)}${pick(TAIL_SUFFIXES)}`
      : `${pick(TAIL_ROOTS)}-${pick(TAIL_ROOTS)}${pick(TAIL_SUFFIXES)}`;
    const name = scoped ? `${pick(SCOPES)}/${body}` : body;
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  // Deterministic fallback; in practice the loop above always finds a free name.
  let index = 0;
  while (taken.has(`utility-module-${index}`)) index += 1;
  const name = `utility-module-${index}`;
  taken.add(name);
  return name;
}

const DESCRIPTION_VERBS = [
  "A tiny helper for",
  "Zero-dependency utilities for",
  "A fast implementation of",
  "Ergonomic bindings for",
  "A minimal wrapper around",
  "Predictable, well-tested helpers for",
  "A streaming implementation of",
  "Type-safe primitives for",
];

const DESCRIPTION_OBJECTS = [
  "working with buffers", "normalising file paths", "parsing structured text",
  "matching glob patterns", "debouncing user input", "retrying flaky operations",
  "traversing nested objects", "formatting human-readable output",
  "validating configuration", "handling character encodings",
  "measuring elapsed time", "generating unique identifiers",
  "comparing deep structures", "resolving module specifiers",
  "escaping untrusted strings", "walking directory trees",
];

// ------------------------------------------------------------- maintainers --

const GIVEN_NAMES = [
  "Ana", "Bram", "Chidi", "Dara", "Eero", "Fatima", "Gustavo", "Hana", "Ines", "Jonas",
  "Kavya", "Liesel", "Mateo", "Noor", "Oskar", "Priya", "Quentin", "Rania", "Sven", "Thandi",
  "Umar", "Vera", "Wes", "Xiulan", "Yusuf", "Zofia", "Aditi", "Bo", "Clara", "Dmitri",
  "Elif", "Farid", "Greta", "Hiro", "Ivy", "Jarek", "Kwame", "Lena", "Milo", "Nadia",
  "Otto", "Pilar", "Rafa", "Sanne", "Tomas", "Ulla", "Viktor", "Wren", "Yara", "Zaid",
];

const FAMILY_NAMES = [
  "Alvarez", "Bakker", "Chen", "Dvorak", "Eriksen", "Ferreira", "Grigoryan", "Haddad",
  "Ito", "Jensen", "Kowalski", "Lindqvist", "Mbeki", "Novak", "Okafor", "Petrov",
  "Quiroga", "Rasmussen", "Silva", "Takahashi", "Ustinov", "Vega", "Walsh", "Xu",
  "Yilmaz", "Zheng", "Andersson", "Bianchi", "Costa", "Duarte", "Engel", "Fournier",
  "Gallo", "Horvat", "Ibrahim", "Jokinen", "Kaur", "Laurent", "Moreau", "Nagy",
];

function makeMaintainer(taken: Set<string>): MaintainerNode {
  const given = pick(GIVEN_NAMES);
  const family = pick(FAMILY_NAMES);

  let username = "";
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const style = randomInt(0, 3);
    const candidate =
      style === 0
        ? `${given}${family}`.toLowerCase()
        : style === 1
          ? `${given[0]}${family}`.toLowerCase()
          : style === 2
            ? `${given}_${family}`.toLowerCase()
            : `${given}${randomInt(1, 999)}`.toLowerCase();
    if (!taken.has(candidate)) {
      username = candidate;
      break;
    }
  }
  if (!username) {
    let index = 0;
    while (taken.has(`dev${index}`)) index += 1;
    username = `dev${index}`;
  }
  taken.add(username);

  return {
    username,
    name: `${given} ${family}`,
    joinedAt: dateDaysAgo(randomInt(300, 5200)),
    // Registry-wide 2FA adoption is far from universal, and the accounts that
    // lack it are the ones that show up in the takeover-risk report.
    twoFactorEnabled: chance(0.71),
    daysSinceLastPublish: Math.floor(Math.pow(random(), 2.2) * 1600),
  };
}

// ------------------------------------------------------------ applications --

type ApplicationSpec = Omit<ApplicationNode, "id"> & { id: string; directDeps: string[]; extraDeps: number };

const APPLICATIONS: ApplicationSpec[] = [
  { id: "checkout-api", name: "Checkout API", team: "Payments", criticality: "tier-1", environment: "production", description: "Takes payment and issues the order confirmation. Every revenue-bearing request lands here.", directDeps: ["express", "axios", "lodash", "qs", "semver"], extraDeps: 22 },
  { id: "customer-portal", name: "Customer Portal", team: "Growth", criticality: "tier-1", environment: "production", description: "The signed-in web experience customers use to track shipments and manage billing.", directDeps: ["react", "react-dom", "axios", "webpack", "postcss"], extraDeps: 28 },
  { id: "tracking-gateway", name: "Tracking Gateway", team: "Fulfilment", criticality: "tier-1", environment: "production", description: "Public API that carriers push scan events into. High volume, untrusted input.", directDeps: ["express", "ws", "node-fetch", "json5"], extraDeps: 19 },
  { id: "pricing-engine", name: "Pricing Engine", team: "Commercial", criticality: "tier-1", environment: "production", description: "Computes quoted rates from tariff tables and live capacity.", directDeps: ["lodash", "semver", "micromatch"], extraDeps: 25 },
  { id: "warehouse-scanner", name: "Warehouse Scanner", team: "Fulfilment", criticality: "tier-2", environment: "production", description: "Handheld-device backend for pick, pack and dispatch scanning.", directDeps: ["express", "ws", "tough-cookie"], extraDeps: 19 },
  { id: "route-planner", name: "Route Planner", team: "Fulfilment", criticality: "tier-2", environment: "production", description: "Nightly optimiser that assigns consignments to vehicles and drivers.", directDeps: ["lodash", "axios", "minimist"], extraDeps: 22 },
  { id: "partner-webhooks", name: "Partner Webhooks", team: "Platform", criticality: "tier-1", environment: "production", description: "Signs and delivers outbound events to integration partners.", directDeps: ["express", "axios", "follow-redirects", "ws"], extraDeps: 16 },
  { id: "identity-service", name: "Identity Service", team: "Platform", criticality: "tier-1", environment: "production", description: "Issues and validates access tokens for every other service.", directDeps: ["express", "tough-cookie", "cookie", "semver"], extraDeps: 19 },
  { id: "invoice-renderer", name: "Invoice Renderer", team: "Finance", criticality: "tier-2", environment: "production", description: "Turns billing runs into PDF invoices and emails them out.", directDeps: ["lodash", "serialize-javascript", "postcss"], extraDeps: 22 },
  { id: "claims-workflow", name: "Claims Workflow", team: "Support", criticality: "tier-2", environment: "production", description: "Case management for damaged and missing consignments.", directDeps: ["react", "react-dom", "axios", "json5"], extraDeps: 22 },
  { id: "support-console", name: "Support Console", team: "Support", criticality: "tier-2", environment: "internal", description: "Internal tool agents use to inspect and amend orders.", directDeps: ["react", "react-dom", "webpack", "eslint"], extraDeps: 25 },
  { id: "carrier-adapter", name: "Carrier Adapter", team: "Fulfilment", criticality: "tier-1", environment: "production", description: "Normalises the eleven different carrier APIs into one internal contract.", directDeps: ["axios", "node-fetch", "qs", "lodash"], extraDeps: 22 },
  { id: "notifications", name: "Notification Service", team: "Platform", criticality: "tier-2", environment: "production", description: "Fans out email, SMS and push notifications.", directDeps: ["express", "node-fetch", "lodash"], extraDeps: 19 },
  { id: "audit-log", name: "Audit Log", team: "Security", criticality: "tier-1", environment: "production", description: "Append-only record of every privileged action, retained for seven years.", directDeps: ["express", "ini", "semver"], extraDeps: 16 },
  { id: "fraud-scoring", name: "Fraud Scoring", team: "Payments", criticality: "tier-1", environment: "production", description: "Scores each checkout attempt before the card is charged.", directDeps: ["axios", "lodash", "micromatch"], extraDeps: 19 },
  { id: "reporting-api", name: "Reporting API", team: "Data", criticality: "tier-2", environment: "internal", description: "Serves the aggregates behind the executive dashboards.", directDeps: ["express", "lodash", "y18n"], extraDeps: 19 },
  { id: "etl-pipeline", name: "ETL Pipeline", team: "Data", criticality: "tier-2", environment: "internal", description: "Moves operational data into the warehouse every fifteen minutes.", directDeps: ["minimist", "json5", "glob-parent", "lodash"], extraDeps: 22 },
  { id: "dashboard-web", name: "Ops Dashboard", team: "Data", criticality: "tier-3", environment: "internal", description: "Real-time view of network health for the operations floor.", directDeps: ["react", "react-dom", "webpack", "postcss", "ws"], extraDeps: 25 },
  { id: "mobile-bff", name: "Mobile BFF", team: "Growth", criticality: "tier-1", environment: "production", description: "Backend-for-frontend that the iOS and Android apps talk to.", directDeps: ["express", "axios", "qs"], extraDeps: 22 },
  { id: "marketing-site", name: "Marketing Site", team: "Growth", criticality: "tier-3", environment: "production", description: "The public marketing and pricing pages.", directDeps: ["react", "react-dom", "postcss", "webpack"], extraDeps: 22 },
  { id: "status-page", name: "Status Page", team: "Platform", criticality: "tier-3", environment: "production", description: "Publishes incident and uptime information to customers.", directDeps: ["express", "node-fetch"], extraDeps: 13 },
  { id: "feature-flags", name: "Feature Flags", team: "Platform", criticality: "tier-2", environment: "production", description: "Evaluates rollout rules for every service at request time.", directDeps: ["express", "semver", "lodash"], extraDeps: 16 },
  { id: "config-service", name: "Config Service", team: "Platform", criticality: "tier-1", environment: "production", description: "Distributes runtime configuration to the fleet.", directDeps: ["ini", "json5", "express"], extraDeps: 16 },
  { id: "search-indexer", name: "Search Indexer", team: "Data", criticality: "tier-3", environment: "internal", description: "Keeps the consignment search index in sync with the write path.", directDeps: ["lodash", "micromatch", "axios"], extraDeps: 19 },
  { id: "returns-portal", name: "Returns Portal", team: "Support", criticality: "tier-2", environment: "production", description: "Self-service returns booking and label generation.", directDeps: ["react", "react-dom", "axios", "express"], extraDeps: 22 },
  { id: "capacity-planner", name: "Capacity Planner", team: "Commercial", criticality: "tier-3", environment: "internal", description: "Forecasts depot and vehicle capacity a quarter ahead.", directDeps: ["lodash", "minimist", "semver"], extraDeps: 19 },
  { id: "billing-sync", name: "Billing Sync", team: "Finance", criticality: "tier-1", environment: "production", description: "Reconciles the ledger against the payment processor nightly.", directDeps: ["axios", "lodash", "decode-uri-component"], extraDeps: 19 },
  { id: "compliance-export", name: "Compliance Export", team: "Security", criticality: "tier-2", environment: "internal", description: "Produces the regulatory extracts auditors ask for.", directDeps: ["express", "shell-quote", "lodash"], extraDeps: 16 },
  { id: "device-registry", name: "Device Registry", team: "Fulfilment", criticality: "tier-3", environment: "internal", description: "Inventory of handheld scanners and vehicle telematics units.", directDeps: ["express", "ws", "semver"], extraDeps: 16 },
  { id: "developer-portal", name: "Developer Portal", team: "Platform", criticality: "tier-3", environment: "production", description: "API documentation and sandbox keys for integration partners.", directDeps: ["react", "react-dom", "webpack", "eslint", "postcss"], extraDeps: 22 },
];

// ------------------------------------------------- synthetic advisory text --

const SIM_WEAKNESSES: Array<{ cwe: string; summaries: string[]; severities: Severity[] }> = [
  {
    cwe: "CWE-1333 Inefficient Regular Expression",
    severities: ["moderate", "moderate", "high"],
    summaries: [
      "Catastrophic backtracking in the input-matching expression allows denial of service.",
      "A crafted input string causes exponential matching time in the parser.",
    ],
  },
  {
    cwe: "CWE-1321 Prototype Pollution",
    severities: ["high", "high", "critical"],
    summaries: [
      "A crafted key path allows an attacker to add properties to Object.prototype.",
      "Deep-merge does not guard against __proto__, allowing prototype pollution.",
    ],
  },
  {
    cwe: "CWE-22 Path Traversal",
    severities: ["high", "critical"],
    summaries: [
      "Insufficient normalisation allows reads outside the intended directory.",
      "A crafted archive entry can be written outside the extraction root.",
    ],
  },
  {
    cwe: "CWE-79 Cross-site Scripting",
    severities: ["moderate", "high"],
    summaries: [
      "Output is not escaped before being inserted into the document.",
      "The sanitiser misses an attribute-context escape, allowing script injection.",
    ],
  },
  {
    cwe: "CWE-400 Uncontrolled Resource Consumption",
    severities: ["moderate", "high"],
    summaries: [
      "An unbounded buffer grows without limit while parsing untrusted input.",
      "Deeply nested input causes stack exhaustion and crashes the process.",
    ],
  },
  {
    cwe: "CWE-78 Command Injection",
    severities: ["critical"],
    summaries: ["Arguments are passed to a shell without quoting, allowing command injection."],
  },
  {
    cwe: "CWE-200 Information Exposure",
    severities: ["moderate", "low"],
    summaries: [
      "Credentials are written to the debug log in plain text.",
      "Error responses leak absolute filesystem paths.",
    ],
  },
];

const CVSS_BY_SEVERITY: Record<Severity, [number, number]> = {
  critical: [9.0, 10.0],
  high: [7.0, 8.9],
  moderate: [4.0, 6.9],
  low: [1.5, 3.9],
};

// ------------------------------------------------------------ the builder --

const TAIL_PACKAGE_COUNT = 6_500;
const MAINTAINER_COUNT = 1_100;
const SIMULATED_ADVISORY_COUNT = 150;
/** Deepest layer a generated package may sit at. Real npm trees bottom out around here. */
const MAX_LAYER = 6;
/** Ceiling on the preferential-attachment weight for maintainers — see the comment at the call site. */
const MAX_MAINTAINER_LOAD = 90;

export function buildDataset(): Dataset {
  // 1. Core packages, with their layer derived from their real dependency graph.
  const coreDeps = new Map<string, string[]>();
  for (const [name, , , , deps] of CORE_PACKAGES) {
    coreDeps.set(name, deps.split(" ").filter(Boolean));
  }

  const layerCache = new Map<string, number>();
  function coreLayer(name: string, seen: Set<string> = new Set()): number {
    const cached = layerCache.get(name);
    if (cached !== undefined) return cached;
    if (seen.has(name)) return 0; // defensive: the curated data is acyclic
    seen.add(name);
    const deps = coreDeps.get(name) ?? [];
    const layer = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((dep) => coreLayer(dep, seen)));
    layerCache.set(name, layer);
    return layer;
  }

  const packages: PackageNode[] = [];
  const packagesByName = new Map<string, PackageNode>();
  const takenNames = new Set<string>();

  for (const [name, version, license, weeklyMillions, , description] of CORE_PACKAGES) {
    takenNames.add(name);
    const node: PackageNode = {
      name,
      ecosystem: "npm",
      version,
      description,
      repoUrl: `https://github.com/${name.replace(/^@[^/]+\//, "").replace(/\./g, "-")}/${name.replace(/^@[^/]+\//, "")}`,
      weeklyDownloads: Math.round(weeklyMillions * 1_000_000 * (0.85 + random() * 0.3)),
      lastPublished: dateDaysAgo(randomInt(20, 900)),
      deprecated: false,
      license,
      layer: coreLayer(name),
    };
    packages.push(node);
    packagesByName.set(name, node);
  }

  const packageDependencies: PackageDependency[] = [];
  for (const [name, , , , deps] of CORE_PACKAGES) {
    for (const dep of deps.split(" ").filter(Boolean)) {
      if (!packagesByName.has(dep)) {
        throw new Error(`Core package "${name}" depends on "${dep}", which is not in CORE_PACKAGES.`);
      }
      packageDependencies.push({
        from: name,
        to: dep,
        scope: "runtime",
        versionRange: `^${packagesByName.get(dep)!.version}`,
      });
    }
  }

  // 2. Long tail. Packages are assigned a layer first, then wired to strictly
  //    lower layers — which keeps DEPENDS_ON acyclic by construction and makes
  //    every variable-length traversal terminate.
  //
  //    Layer shares are skewed towards the bottom: the registry has far more
  //    leaf utilities than frameworks.
  const layerShares = [0.2, 0.18, 0.17, 0.16, 0.13, 0.1, 0.06];
  const byLayer: PackageNode[][] = Array.from({ length: MAX_LAYER + 1 }, () => []);
  for (const node of packages) byLayer[Math.min(node.layer, MAX_LAYER)].push(node);

  // Barabási–Albert style preferential attachment: the chance a package is
  // picked as a dependency grows with the number of dependents it already has,
  // so the graph grows its own hubs instead of spreading edges evenly. Real
  // registries look like this — a few hundred packages carry everything.
  //
  // Core packages start with a prior derived from their real download counts,
  // which lets the genuinely ubiquitous ones (debug, semver, minimatch) become
  // hubs here too rather than having to win a lottery.
  const inDegree = new Map<string, number>();
  for (const node of packages) {
    inDegree.set(node.name, Math.round(Math.pow(Math.log10(1 + node.weeklyDownloads / 1000), 2) * 1.6));
  }
  //
  // The exponent is deliberately sub-linear. Classic BA uses a linear kernel,
  // but at this scale that collapses the reachable graph onto a few hundred
  // universal hubs: every application ends up with an almost identical
  // dependency tree, every blast radius comes back as "all 30 apps", and the
  // reports stop discriminating between findings. Sub-linear attachment still
  // produces a heavy tail while leaving the trees genuinely different.
  const attachmentWeight = (node: PackageNode) => 1 + Math.pow(inDegree.get(node.name) ?? 0, 0.8);

  for (let i = 0; i < TAIL_PACKAGE_COUNT; i += 1) {
    const roll = random();
    let layer = 0;
    let cumulative = 0;
    for (let candidate = 0; candidate <= MAX_LAYER; candidate += 1) {
      cumulative += layerShares[candidate];
      if (roll <= cumulative) {
        layer = candidate;
        break;
      }
      layer = candidate;
    }

    const name = makePackageName(takenNames);
    // Downloads follow a heavy-tailed distribution: most packages are obscure,
    // a few are everywhere. Lower layers skew more popular because they sit
    // underneath everything else.
    const popularity = Math.pow(random(), 3.1);
    const layerBoost = 1 + (MAX_LAYER - layer) * 0.55;
    const node: PackageNode = {
      name,
      ecosystem: "npm",
      version: `${randomInt(0, 8)}.${randomInt(0, 20)}.${randomInt(0, 12)}`,
      description: `${pick(DESCRIPTION_VERBS)} ${pick(DESCRIPTION_OBJECTS)}.`,
      repoUrl: `https://github.com/${name.replace(/^@[^/]+\//, "")}/${name.replace(/^@[^/]+\//, "")}`,
      weeklyDownloads: Math.max(120, Math.round(popularity * layerBoost * 4_500_000)),
      lastPublished: dateDaysAgo(randomInt(5, 2400)),
      deprecated: chance(0.035),
      license: pickWeighted(TAIL_LICENSE_WEIGHTS, ([, weight]) => weight)[0],
      layer,
    };
    packages.push(node);
    packagesByName.set(name, node);
    byLayer[layer].push(node);

    if (layer === 0) continue;

    const depCount = Math.min(2 + Math.floor(Math.pow(random(), 1.4) * 8), 10);
    const chosen = new Set<string>();
    for (let attempt = 0; attempt < depCount * 5 && chosen.size < depCount; attempt += 1) {
      // Most dependencies are on the layer immediately below. Without this bias
      // almost every edge would jump straight to the huge layer-0 pool, and the
      // dependency tree would be two levels deep instead of six — which would
      // quietly remove the thing the app exists to explore.
      const targetLayer = chance(0.62) ? layer - 1 : randomInt(0, layer - 1);
      const candidates = byLayer[targetLayer];
      if (candidates.length === 0) continue;

      const candidate = pickWeighted(candidates, attachmentWeight);
      if (chosen.has(candidate.name)) continue;
      chosen.add(candidate.name);
      inDegree.set(candidate.name, (inDegree.get(candidate.name) ?? 0) + 1);
      packageDependencies.push({
        from: name,
        to: candidate.name,
        // optionalDependencies are declared but not always installed, so a path
        // that runs through one does not prove the code is actually present.
        scope: chance(0.06) ? "optional" : "runtime",
        versionRange: `^${candidate.version}`,
      });
    }
  }

  // 3. Applications and their direct dependencies.
  const applications: ApplicationNode[] = [];
  const applicationDependencies: ApplicationDependency[] = [];
  // Apps pull from the upper layers, the way a real service depends on
  // frameworks and mid-level libraries rather than on `is-number` directly.
  const appCandidatePool = packages.filter((pkg) => pkg.layer >= 3);

  // Applications draw their extra dependencies from a couple of clusters rather
  // than from the whole registry.
  //
  // Without this every service picks from the same hub-weighted pool, their
  // trees overlap almost entirely, and every row on the dashboard shows the
  // same numbers — a report that ranks thirty services identically is not a
  // report. Real organisations cluster the same way: the front ends share a
  // build-tooling world, the back ends share a server world, and the data
  // services share a third. The shared core is still shared; what differs is
  // the tail each service drags in behind it.
  const CLUSTER_COUNT = 6;
  const clusterOf = new Map<string, number>();
  for (const pkg of appCandidatePool) {
    let hash = 0;
    for (let i = 0; i < pkg.name.length; i += 1) hash = (hash * 31 + pkg.name.charCodeAt(i)) >>> 0;
    clusterOf.set(pkg.name, hash % CLUSTER_COUNT);
  }
  // Teams sit in the same part of the graph as each other, which is what makes
  // the team roll-up on the dashboard say something.
  const teamClusters = new Map<string, [number, number]>();
  for (const spec of APPLICATIONS) {
    if (teamClusters.has(spec.team)) continue;
    const primary = teamClusters.size % CLUSTER_COUNT;
    teamClusters.set(spec.team, [primary, (primary + 1 + randomInt(0, 2)) % CLUSTER_COUNT]);
  }

  for (const spec of APPLICATIONS) {
    applications.push({
      id: spec.id,
      name: spec.name,
      team: spec.team,
      criticality: spec.criticality,
      environment: spec.environment,
      description: spec.description,
    });

    const chosen = new Set<string>(spec.directDeps);
    for (const dep of spec.directDeps) {
      applicationDependencies.push({
        from: spec.id,
        to: dep,
        scope: "runtime",
        versionRange: `^${packagesByName.get(dep)!.version}`,
      });
    }

    const [primaryCluster, secondaryCluster] = teamClusters.get(spec.team)!;
    const inCluster = appCandidatePool.filter((pkg) => {
      const cluster = clusterOf.get(pkg.name);
      return cluster === primaryCluster || cluster === secondaryCluster;
    });
    const drawPool = inCluster.length >= spec.extraDeps ? inCluster : appCandidatePool;

    for (let i = 0; i < spec.extraDeps && drawPool.length > 0; i += 1) {
      // A tenth of the time, reach outside the cluster — no real service's
      // dependency list is perfectly tidy, and the overlap it creates is what
      // makes the shared-chokepoint reports interesting.
      const candidate = pickWeighted(chance(0.1) ? appCandidatePool : drawPool, attachmentWeight);
      if (chosen.has(candidate.name)) continue;
      chosen.add(candidate.name);
      applicationDependencies.push({
        from: spec.id,
        to: candidate.name,
        // Dev dependencies never ship, so a vulnerability reached only through
        // one is real but much less urgent — the UI lets you filter them out.
        scope: chance(0.22) ? "dev" : "runtime",
        versionRange: `^${candidate.version}`,
      });
    }
  }

  // 4. Prune to the reachable subgraph.
  //
  //    The generator builds a small registry and then keeps only the part of it
  //    that at least one application actually pulls in. That is what makes this
  //    graph an SBOM rather than a registry mirror: every node in the database
  //    is something Meridian ships or builds with, so no query can return a
  //    result that is technically true but operationally meaningless.
  //
  //    Reachability here follows optional edges as well as runtime ones — an
  //    optional dependency is still declared in the tree. Whether a *specific*
  //    path is fully installed is a question the queries answer, and it only
  //    stays a meaningful question if optional-only packages are present.
  function computeReachable(): Set<string> {
    const outgoing = new Map<string, string[]>();
    for (const edge of packageDependencies) {
      const list = outgoing.get(edge.from);
      if (list) list.push(edge.to);
      else outgoing.set(edge.from, [edge.to]);
    }

    const reachable = new Set<string>();
    const queue: string[] = [];
    for (const edge of applicationDependencies) {
      if (!reachable.has(edge.to)) {
        reachable.add(edge.to);
        queue.push(edge.to);
      }
    }
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const next of outgoing.get(current) ?? []) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }
    return reachable;
  }

  {
    let reachable = computeReachable();

    // The curated advisories were chosen by hand because they tell a story, so
    // none of them may be pruned away for want of a dependent. Any target that
    // nothing happens to depend on gets adopted by a reachable package sitting
    // above it — which is a legitimate edge to add, since a package at a higher
    // layer depending on a lower-layer utility is exactly what the rest of the
    // generator produces.
    const orphanedTargets = CORE_ADVISORIES.filter((row) => !reachable.has(row.packageName));
    for (const row of orphanedTargets) {
      const target = packagesByName.get(row.packageName);
      if (!target) throw new Error(`Advisory ${row.id} targets unknown package "${row.packageName}".`);

      const adopters = packages.filter((pkg) => reachable.has(pkg.name) && pkg.layer > target.layer);
      if (adopters.length === 0) {
        throw new Error(`No reachable package sits above "${target.name}" (layer ${target.layer}) to depend on it.`);
      }
      const adopter = pickWeighted(adopters, attachmentWeight);
      packageDependencies.push({
        from: adopter.name,
        to: target.name,
        scope: "runtime",
        versionRange: `^${target.version}`,
      });
    }

    if (orphanedTargets.length > 0) reachable = computeReachable();

    for (let i = packages.length - 1; i >= 0; i -= 1) {
      if (!reachable.has(packages[i].name)) {
        packagesByName.delete(packages[i].name);
        packages.splice(i, 1);
      }
    }
    for (let i = packageDependencies.length - 1; i >= 0; i -= 1) {
      const edge = packageDependencies[i];
      if (!reachable.has(edge.from) || !reachable.has(edge.to)) packageDependencies.splice(i, 1);
    }
  }

  // 5. Maintainers. A few prolific accounts look after dozens of packages; most
  //    look after one or two. That imbalance is the whole point of the takeover
  //    report.
  const maintainers: MaintainerNode[] = [];
  const takenUsernames = new Set<string>();
  for (let i = 0; i < MAINTAINER_COUNT; i += 1) {
    maintainers.push(makeMaintainer(takenUsernames));
  }

  const maintains: Maintains[] = [];
  const maintainerLoad = new Map<string, number>();
  for (const maintainer of maintainers) maintainerLoad.set(maintainer.username, 0);

  for (const pkg of packages) {
    // Crucially, this is *not* correlated with popularity. The packages that
    // have caused real supply-chain incidents — event-stream, ua-parser-js,
    // node-ipc — were downloaded millions of times a week and looked after by
    // one person. If popular packages were given more maintainers here, the
    // single-maintainer report would only ever surface obscure leaves and the
    // whole feature would be a lie.
    const count = chance(0.46) ? 1 : randomInt(2, pkg.weeklyDownloads > 5_000_000 ? 5 : 3);

    const assigned = new Set<string>();
    for (let slot = 0; slot < count; slot += 1) {
      // Weighting by existing load concentrates ownership, reproducing the real
      // registry's long tail of one-person-many-packages accounts. The exponent
      // is deliberately sub-linear and the load is capped: super-linear
      // attachment collapses into a single account owning everything, which is
      // neither realistic nor interesting to look at.
      const maintainer = pickWeighted(maintainers, (m) =>
        1 + Math.pow(Math.min(maintainerLoad.get(m.username) ?? 0, MAX_MAINTAINER_LOAD), 0.92),
      );
      if (assigned.has(maintainer.username)) continue;
      assigned.add(maintainer.username);
      maintainerLoad.set(maintainer.username, (maintainerLoad.get(maintainer.username) ?? 0) + 1);
      maintains.push({
        username: maintainer.username,
        packageName: pkg.name,
        since: dateDaysAgo(randomInt(60, 4000)),
        role: slot === 0 ? "owner" : "collaborator",
      });
    }
  }

  // Accounts that ended up with nothing to look after are dropped rather than
  // left as orphan nodes cluttering every count in the UI.
  for (let i = maintainers.length - 1; i >= 0; i -= 1) {
    if ((maintainerLoad.get(maintainers[i].username) ?? 0) === 0) maintainers.splice(i, 1);
  }

  // 6. Advisories: the curated real ones, then a simulated long tail biased
  //    towards packages that lots of things depend on.
  const advisories: AdvisoryNode[] = [];
  const affects: Affects[] = [];

  for (const row of CORE_ADVISORIES as CoreAdvisoryRow[]) {
    if (!packagesByName.has(row.packageName)) {
      throw new Error(`Advisory ${row.id} targets unknown package "${row.packageName}".`);
    }
    advisories.push({
      id: row.id,
      severity: row.severity,
      cvss: row.cvss,
      cwe: row.cwe,
      summary: row.summary,
      publishedAt: row.publishedAt,
      simulated: false,
    });
    affects.push({
      advisoryId: row.id,
      packageName: row.packageName,
      vulnerableRange: row.vulnerableRange,
      patchedIn: row.patchedIn,
    });
  }

  const advisedPackages = new Set(affects.map((a) => a.packageName));
  const simulationPool = packages.filter((pkg) => !advisedPackages.has(pkg.name) && pkg.layer <= 4);

  for (let i = 0; i < SIMULATED_ADVISORY_COUNT && simulationPool.length > 0; i += 1) {
    // Biased towards packages plenty of things depend on — so most findings
    // reach something, which is what a real feed filtered to your own SBOM
    // looks like — but far more weakly than dependency attachment is. Reusing
    // the full attachment weight here would land almost every advisory on a
    // shared core hub, and then every application would show an identical
    // count and the per-service ranking would mean nothing.
    const target = pickWeighted(simulationPool, (pkg) =>
      1 + Math.pow(inDegree.get(pkg.name) ?? 0, 0.35),
    );
    if (advisedPackages.has(target.name)) continue;
    advisedPackages.add(target.name);

    const weakness = pick(SIM_WEAKNESSES);
    const severity = pick(weakness.severities);
    const [minCvss, maxCvss] = CVSS_BY_SEVERITY[severity];
    const id = `GHSA-SIM-${String(i + 1).padStart(4, "0")}`;
    const patchMajor = Number(target.version.split(".")[0]);
    const patchMinor = Number(target.version.split(".")[1]) + 1;

    advisories.push({
      id,
      severity,
      cvss: Math.round((minCvss + random() * (maxCvss - minCvss)) * 10) / 10,
      cwe: weakness.cwe,
      summary: pick(weakness.summaries),
      publishedAt: dateDaysAgo(randomInt(10, 1500)),
      simulated: true,
    });
    affects.push({
      advisoryId: id,
      packageName: target.name,
      vulnerableRange: `<${patchMajor}.${patchMinor}.0`,
      patchedIn: `${patchMajor}.${patchMinor}.0`,
    });
  }

  // 6. Licences.
  const licensedUnder: LicensedUnder[] = packages.map((pkg) => ({
    packageName: pkg.name,
    licenseId: LICENSES.some((l) => l.id === pkg.license) ? pkg.license : "MIT",
  }));

  return {
    licenses: LICENSES,
    packages,
    maintainers,
    applications,
    advisories,
    packageDependencies,
    applicationDependencies,
    maintains,
    affects,
    licensedUnder,
    reaches: computeReachability(applications, applicationDependencies, packageDependencies),
  };
}

/**
 * Builds the `REACHES` closure with two breadth-first walks per application:
 * one over runtime edges only, one over every declared edge.
 *
 * Breadth-first order means the first time a package is seen is by definition
 * its shortest route, so hop counts fall out of the walk rather than needing a
 * second pass.
 *
 * This runs in the loader rather than as Cypher because a full closure computed
 * in-database on a burstable 0.5 vCPU instance is exactly the slow traversal it
 * exists to avoid. The result is verifiable against the live queries: the
 * blast-radius page traverses the dependency edges directly and must agree with
 * the count the dashboard reads from here.
 */
function computeReachability(
  applications: ApplicationNode[],
  applicationDependencies: ApplicationDependency[],
  packageDependencies: PackageDependency[],
): Reaches[] {
  const runtimeOut = new Map<string, string[]>();
  const declaredOut = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, from: string, to: string) => {
    const list = map.get(from);
    if (list) list.push(to);
    else map.set(from, [to]);
  };

  for (const edge of packageDependencies) {
    push(declaredOut, edge.from, edge.to);
    if (edge.scope === "runtime") push(runtimeOut, edge.from, edge.to);
  }

  const appRuntimeEntry = new Map<string, string[]>();
  const appDeclaredEntry = new Map<string, string[]>();
  for (const edge of applicationDependencies) {
    push(appDeclaredEntry, edge.from, edge.to);
    if (edge.scope === "runtime") push(appRuntimeEntry, edge.from, edge.to);
  }

  function walk(entry: string[], out: Map<string, string[]>): Map<string, number> {
    const distance = new Map<string, number>();
    let frontier: string[] = [];
    for (const name of entry) {
      if (!distance.has(name)) {
        distance.set(name, 1);
        frontier.push(name);
      }
    }
    for (let depth = 2; depth <= REACH_DEPTH && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const current of frontier) {
        for (const neighbour of out.get(current) ?? []) {
          if (!distance.has(neighbour)) {
            distance.set(neighbour, depth);
            next.push(neighbour);
          }
        }
      }
      frontier = next;
    }
    return distance;
  }

  const rows: Reaches[] = [];
  for (const application of applications) {
    const installed = walk(appRuntimeEntry.get(application.id) ?? [], runtimeOut);
    const declared = walk(appDeclaredEntry.get(application.id) ?? [], declaredOut);

    for (const [packageName, declaredHops] of declared) {
      const installedHops = installed.get(packageName);
      rows.push({
        applicationId: application.id,
        packageName,
        installed: installedHops !== undefined,
        hops: installedHops ?? declaredHops,
        declaredHops,
      });
    }
  }

  return rows;
}

/** Row counts, printed by the seed script and quoted in the README. */
export function summarize(dataset: Dataset) {
  return {
    nodes: {
      Application: dataset.applications.length,
      Package: dataset.packages.length,
      Maintainer: dataset.maintainers.length,
      Advisory: dataset.advisories.length,
      License: dataset.licenses.length,
    },
    relationships: {
      "DEPENDS_ON (app → package)": dataset.applicationDependencies.length,
      "DEPENDS_ON (package → package)": dataset.packageDependencies.length,
      MAINTAINS: dataset.maintains.length,
      AFFECTS: dataset.affects.length,
      LICENSED_UNDER: dataset.licensedUnder.length,
      "REACHES (derived)": dataset.reaches.length,
    },
  };
}
