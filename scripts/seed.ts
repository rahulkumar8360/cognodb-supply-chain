/**
 * Loads the generated dataset into CognoDB.
 *
 *   npm run seed           # create constraints, then load (skips if data exists)
 *   npm run seed -- --reset  # delete everything first, then load
 *
 * Everything is written through parameterised `UNWIND $rows AS row` statements
 * in batches. That keeps the number of round trips small — which matters a lot
 * on a free-tier instance — and means the query text is a constant, so the
 * server plans it once and reuses the plan for every batch.
 */

import { loadEnvFiles } from "./load-env";

loadEnvFiles();

import neo4j, { Driver } from "neo4j-driver";

import { buildDataset, summarize } from "./dataset";

const BATCH_SIZE = 500;

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!value) {
    console.error(
      `\n  Missing ${name}.\n\n  Copy .env.example to .env.local and fill in the connection details from\n  the CognoDB console (https://console.cognodb.com).\n`,
    );
    process.exit(1);
  }
  return value;
}

/**
 * Schema. Uniqueness constraints double as indexes on the lookup keys, and the
 * extra indexes cover the properties the app filters and sorts on.
 *
 * Each statement is run independently and a failure is reported rather than
 * fatal: constraint syntax is the one place where a Cypher implementation is
 * most likely to differ, and a missing index makes the app slower, not wrong.
 */
const SCHEMA_STATEMENTS: Array<{ label: string; cypher: string }> = [
  { label: "Package.name unique", cypher: "CREATE CONSTRAINT package_name IF NOT EXISTS FOR (p:Package) REQUIRE p.name IS UNIQUE" },
  { label: "Application.id unique", cypher: "CREATE CONSTRAINT application_id IF NOT EXISTS FOR (a:Application) REQUIRE a.id IS UNIQUE" },
  { label: "Maintainer.username unique", cypher: "CREATE CONSTRAINT maintainer_username IF NOT EXISTS FOR (m:Maintainer) REQUIRE m.username IS UNIQUE" },
  { label: "Advisory.id unique", cypher: "CREATE CONSTRAINT advisory_id IF NOT EXISTS FOR (a:Advisory) REQUIRE a.id IS UNIQUE" },
  { label: "License.id unique", cypher: "CREATE CONSTRAINT license_id IF NOT EXISTS FOR (l:License) REQUIRE l.id IS UNIQUE" },
  { label: "Package.weeklyDownloads index", cypher: "CREATE INDEX package_downloads IF NOT EXISTS FOR (p:Package) ON (p.weeklyDownloads)" },
  { label: "Advisory.severity index", cypher: "CREATE INDEX advisory_severity IF NOT EXISTS FOR (a:Advisory) ON (a.severity)" },
  { label: "License.category index", cypher: "CREATE INDEX license_category IF NOT EXISTS FOR (l:License) ON (l.category)" },
  { label: "REACHES.installed index", cypher: "CREATE INDEX reaches_installed IF NOT EXISTS FOR ()-[r:REACHES]-() ON (r.installed)" },
];

async function applySchema(driver: Driver, database: string) {
  console.log("→ applying schema");
  for (const { label, cypher } of SCHEMA_STATEMENTS) {
    try {
      await driver.executeQuery(cypher, {}, { database });
      console.log(`   ✓ ${label}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`   ! ${label} — skipped (${message.split("\n")[0]})`);
    }
  }
}

async function wipe(driver: Driver, database: string) {
  console.log("→ deleting existing data");
  // Deleted in batches so the transaction never has to hold the whole graph in
  // memory — the free tier has 256 MB and would otherwise run out.
  for (;;) {
    const { records } = await driver.executeQuery(
      `MATCH (n)
       WITH n LIMIT $batch
       DETACH DELETE n
       RETURN count(*) AS deleted`,
      // neo4j.int() because `disableLosslessIntegers` makes plain JS numbers go
      // out as Bolt floats, and LIMIT rejects a float.
      { batch: neo4j.int(5_000) },
      { database },
    );
    const deleted = records[0]?.get("deleted") ?? 0;
    const count = typeof deleted === "number" ? deleted : deleted.toNumber();
    if (count === 0) break;
    process.stdout.write(`   … ${count} nodes deleted\n`);
  }
}

async function loadInBatches<T>(
  driver: Driver,
  database: string,
  label: string,
  rows: T[],
  cypher: string,
): Promise<void> {
  if (rows.length === 0) return;
  const started = Date.now();
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    await driver.executeQuery(cypher, { rows: batch }, { database });
    const done = Math.min(offset + BATCH_SIZE, rows.length);
    process.stdout.write(`\r   ${label}: ${done}/${rows.length}`);
  }
  process.stdout.write(`\r   ✓ ${label}: ${rows.length} in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
}

async function main() {
  const reset = process.argv.includes("--reset");

  const uri = requireEnv("COGNODB_URI");
  const username = requireEnv("COGNODB_USERNAME", "cognodb");
  const password = requireEnv("COGNODB_PASSWORD");
  const database = process.env.COGNODB_DATABASE?.trim() || "neo4j";

  console.log(`\nCognoDB supply-chain seed`);
  console.log(`  target : ${uri.replace(/\/\/([^@]*@)?/, "//")}`);
  console.log(`  database: ${database}\n`);

  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
    disableLosslessIntegers: true,
    connectionTimeout: 15_000,
    userAgent: "cognodb-supply-chain-seed/1.0",
  });

  try {
    const info = await driver.getServerInfo({ database });
    console.log(`→ connected to ${info.address ?? uri} (${info.protocolVersion ?? "bolt"})\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n  Could not connect to CognoDB.\n  ${message}\n`);
    console.error(
      `  Things worth checking:\n` +
        `    • the instance is running (free instances are paused when idle)\n` +
        `    • COGNODB_URI starts with bolt+s:// and matches the console exactly\n` +
        `    • the password is the one shown once at instance creation\n`,
    );
    await driver.close();
    process.exit(1);
  }

  if (reset) {
    await wipe(driver, database);
  } else {
    const { records } = await driver.executeQuery("MATCH (p:Package) RETURN count(p) AS existing", {}, { database });
    const existing = records[0]?.get("existing") ?? 0;
    const count = typeof existing === "number" ? existing : existing.toNumber();
    if (count > 0) {
      console.log(`  The database already holds ${count} packages.`);
      console.log(`  Re-run with --reset to wipe it and load a fresh copy.\n`);
      await driver.close();
      return;
    }
  }

  await applySchema(driver, database);

  console.log("\n→ generating dataset");
  const dataset = buildDataset();
  const summary = summarize(dataset);
  console.log(`   ${Object.values(summary.nodes).reduce((a, b) => a + b, 0)} nodes, ` +
    `${Object.values(summary.relationships).reduce((a, b) => a + b, 0)} relationships\n`);

  console.log("→ loading nodes");
  await loadInBatches(
    driver,
    database,
    "License",
    dataset.licenses,
    `UNWIND $rows AS row
     MERGE (l:License { id: row.id })
     SET l.name = row.name, l.category = row.category`,
  );
  await loadInBatches(
    driver,
    database,
    "Package",
    dataset.packages,
    `UNWIND $rows AS row
     MERGE (p:Package { name: row.name })
     SET p.ecosystem = row.ecosystem,
         p.version = row.version,
         p.description = row.description,
         p.repoUrl = row.repoUrl,
         p.weeklyDownloads = row.weeklyDownloads,
         p.lastPublished = row.lastPublished,
         p.deprecated = row.deprecated,
         p.license = row.license,
         p.layer = row.layer`,
  );
  await loadInBatches(
    driver,
    database,
    "Maintainer",
    dataset.maintainers,
    `UNWIND $rows AS row
     MERGE (m:Maintainer { username: row.username })
     SET m.name = row.name,
         m.joinedAt = row.joinedAt,
         m.twoFactorEnabled = row.twoFactorEnabled,
         m.daysSinceLastPublish = row.daysSinceLastPublish`,
  );
  await loadInBatches(
    driver,
    database,
    "Application",
    dataset.applications,
    `UNWIND $rows AS row
     MERGE (a:Application { id: row.id })
     SET a.name = row.name,
         a.team = row.team,
         a.criticality = row.criticality,
         a.environment = row.environment,
         a.description = row.description`,
  );
  await loadInBatches(
    driver,
    database,
    "Advisory",
    dataset.advisories,
    `UNWIND $rows AS row
     MERGE (a:Advisory { id: row.id })
     SET a.severity = row.severity,
         a.cvss = row.cvss,
         a.cwe = row.cwe,
         a.summary = row.summary,
         a.publishedAt = row.publishedAt,
         a.simulated = row.simulated`,
  );

  console.log("\n→ loading relationships");
  await loadInBatches(
    driver,
    database,
    "LICENSED_UNDER",
    dataset.licensedUnder,
    `UNWIND $rows AS row
     MATCH (p:Package { name: row.packageName })
     MATCH (l:License { id: row.licenseId })
     MERGE (p)-[:LICENSED_UNDER]->(l)`,
  );
  // Dependency scope is encoded in the *relationship type*, not in a property.
  //
  // A property would force every traversal to carry a predicate —
  // `WHERE all(r IN relationships(path) WHERE r.scope = 'runtime')` — which
  // means binding the path, which in turn stops the planner from using its
  // pruning expansion and makes a five-hop query enumerate hundreds of
  // thousands of paths instead of visiting each node once. With the scope in
  // the type, "what is actually installed" is `-[:DEPENDS_ON*1..5]->` and stays
  // fast, while "everything declared" is a type union that is equally fast.
  // The scope is *also* kept as a property, because it is worth displaying.
  await loadInBatches(
    driver,
    database,
    "DEPENDS_ON (package)",
    dataset.packageDependencies.filter((row) => row.scope === "runtime"),
    `UNWIND $rows AS row
     MATCH (from:Package { name: row.from })
     MATCH (to:Package { name: row.to })
     MERGE (from)-[d:DEPENDS_ON]->(to)
     SET d.scope = row.scope, d.versionRange = row.versionRange`,
  );
  await loadInBatches(
    driver,
    database,
    "DEPENDS_ON_OPTIONAL (package)",
    dataset.packageDependencies.filter((row) => row.scope === "optional"),
    `UNWIND $rows AS row
     MATCH (from:Package { name: row.from })
     MATCH (to:Package { name: row.to })
     MERGE (from)-[d:DEPENDS_ON_OPTIONAL]->(to)
     SET d.scope = row.scope, d.versionRange = row.versionRange`,
  );
  await loadInBatches(
    driver,
    database,
    "DEPENDS_ON (application)",
    dataset.applicationDependencies.filter((row) => row.scope === "runtime"),
    `UNWIND $rows AS row
     MATCH (from:Application { id: row.from })
     MATCH (to:Package { name: row.to })
     MERGE (from)-[d:DEPENDS_ON]->(to)
     SET d.scope = row.scope, d.versionRange = row.versionRange`,
  );
  await loadInBatches(
    driver,
    database,
    "DEPENDS_ON_DEV (application)",
    dataset.applicationDependencies.filter((row) => row.scope === "dev"),
    `UNWIND $rows AS row
     MATCH (from:Application { id: row.from })
     MATCH (to:Package { name: row.to })
     MERGE (from)-[d:DEPENDS_ON_DEV]->(to)
     SET d.scope = row.scope, d.versionRange = row.versionRange`,
  );
  await loadInBatches(
    driver,
    database,
    "MAINTAINS",
    dataset.maintains,
    `UNWIND $rows AS row
     MATCH (m:Maintainer { username: row.username })
     MATCH (p:Package { name: row.packageName })
     MERGE (m)-[r:MAINTAINS]->(p)
     SET r.since = row.since, r.role = row.role`,
  );
  await loadInBatches(
    driver,
    database,
    "REACHES (derived closure)",
    dataset.reaches,
    `UNWIND $rows AS row
     MATCH (app:Application { id: row.applicationId })
     MATCH (pkg:Package { name: row.packageName })
     MERGE (app)-[r:REACHES]->(pkg)
     SET r.installed = row.installed, r.hops = row.hops, r.declaredHops = row.declaredHops`,
  );
  await loadInBatches(
    driver,
    database,
    "AFFECTS",
    dataset.affects,
    `UNWIND $rows AS row
     MATCH (a:Advisory { id: row.advisoryId })
     MATCH (p:Package { name: row.packageName })
     MERGE (a)-[r:AFFECTS]->(p)
     SET r.vulnerableRange = row.vulnerableRange, r.patchedIn = row.patchedIn`,
  );

  const { records } = await driver.executeQuery(
    `MATCH (n) WITH count(n) AS nodes
     MATCH ()-[r]->() RETURN nodes, count(r) AS relationships`,
    {},
    { database },
  );
  const verified = records[0];
  console.log(
    `\n✓ done — ${verified?.get("nodes")} nodes and ${verified?.get("relationships")} relationships in the database.\n`,
  );

  await driver.close();
}

main().catch(async (error) => {
  console.error("\nSeed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
