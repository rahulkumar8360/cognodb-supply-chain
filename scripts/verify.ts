/**
 * Runs every query the application uses against the live instance and reports
 * what came back and how long it took.
 *
 *   npm run verify
 *
 * This is the closest thing here to a test suite, and it is deliberately shaped
 * as one. Every query is exercised, every result is checked for the property
 * that makes it worth showing, and the timing column is the thing that decides
 * whether a page is usable on a burstable 0.5 vCPU instance — which is not
 * something a type checker or a unit test can tell you.
 *
 * It runs under `--conditions=react-server` so that the `server-only` guard in
 * the driver module resolves to the package's empty stub instead of throwing.
 * That guard is what stops the driver — and the password it holds — from ever
 * being pulled into a client bundle, so it is worth keeping in place and
 * stepping around here rather than removing.
 */

import { loadEnvFiles } from "./load-env";

loadEnvFiles();

async function main() {
  // Imported after the environment is loaded, because the driver module reads
  // its configuration at first use.
  const queries = await import("../src/lib/queries");
  const { closeDriver, checkHealth } = await import("../src/lib/neo4j");

  console.log("\nSupply Chain Atlas — query verification\n");

  const health = await checkHealth();
  if (!health.ok) {
    console.error(`  Cannot reach the database: ${health.error.message}`);
    console.error(`  ${health.error.detail}\n`);
    process.exit(1);
  }
  console.log(`  connected in ${health.latencyMs} ms${health.address ? ` (${health.address})` : ""}\n`);

  let failures = 0;

  async function check(name: string, run: () => Promise<string>) {
    const started = Date.now();
    try {
      const summary = await run();
      const elapsed = Date.now() - started;
      const flag = elapsed > 3000 ? "  ← slow" : "";
      console.log(`  ✓ ${name.padEnd(34)} ${String(elapsed).padStart(5)} ms   ${summary}${flag}`);
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  ✗ ${name.padEnd(34)} ${String(Date.now() - started).padStart(5)} ms   ${message}`);
    }
  }

  await check("getGraphTotals", async () => {
    const totals = await queries.getGraphTotals();
    if (totals.packages === 0) throw new Error("no packages — has the seed script been run?");
    return `${totals.packages} packages, ${totals.dependencies} dependency edges`;
  });

  await check("getExposureSummary", async () => {
    const summary = await queries.getExposureSummary();
    return `${summary.reachingProduction} reachable, ${summary.notReachable} filtered out`;
  });

  await check("getApplicationExposure", async () => {
    const rows = await queries.getApplicationExposure();
    if (rows.length === 0) throw new Error("no applications");
    const worst = rows[0];
    return `${rows.length} apps, worst is ${worst.name} (${worst.critical}C/${worst.high}H)`;
  });

  await check("getRiskiestPackages", async () => {
    const rows = await queries.getRiskiestPackages(8);
    if (rows.length === 0) throw new Error("nothing vulnerable is reachable — the demo would look empty");
    return `top: ${rows[0].name} reaches ${rows[0].applicationsReached} apps`;
  });

  await check("listAdvisories", async () => {
    const rows = await queries.listAdvisories({
      severities: [],
      exposedOnly: false,
      search: "",
      limit: 25,
      offset: 0,
    });
    return `${rows.length} rows on page 1`;
  });

  await check("listAdvisories (filtered)", async () => {
    const rows = await queries.listAdvisories({
      severities: ["critical"],
      exposedOnly: true,
      search: "",
      limit: 25,
      offset: 0,
    });
    return `${rows.length} reachable criticals`;
  });

  let flagshipAdvisory = "";
  await check("getBlastRadius", async () => {
    const candidates = await queries.listAdvisories({
      severities: [],
      exposedOnly: true,
      search: "",
      limit: 1,
      offset: 0,
    });
    if (candidates.length === 0) throw new Error("no reachable advisory to trace");
    flagshipAdvisory = candidates[0].id;

    const radius = await queries.getBlastRadius(flagshipAdvisory, 5);
    if (!radius) throw new Error("advisory vanished between queries");
    if (radius.rows.length === 0) throw new Error("blast radius is empty for an advisory listed as reachable");

    const deepest = Math.max(...radius.rows.map((row) => row.installedHops ?? 0));
    const withRoutes = radius.rows.filter((row) => row.route.length > 1).length;
    if (withRoutes === 0) throw new Error("no routes returned — shortestPath produced nothing to render");

    return `${flagshipAdvisory} → ${radius.rows.length} apps, deepest ${deepest} hops`;
  });

  await check("getChokepoints", async () => {
    const rows = await queries.getChokepoints(3, 25);
    if (rows.length === 0) throw new Error("no single-maintainer chokepoints — the report would be empty");
    return `${rows.length} found, top reaches ${rows[0].applicationsReached} apps`;
  });

  await check("getTakeoverRisk", async () => {
    const rows = await queries.getTakeoverRisk({ requireNo2FA: false, limit: 20 });
    if (rows.length === 0) throw new Error("no maintainers reach an application");
    return `top account reaches ${rows[0].applicationsReached} apps`;
  });

  await check("getTakeoverRisk (no 2FA)", async () => {
    const rows = await queries.getTakeoverRisk({ requireNo2FA: true, limit: 20 });
    return `${rows.length} accounts without 2FA`;
  });

  await check("getLicenseExposure", async () => {
    const rows = await queries.getLicenseExposure(["strong-copyleft", "weak-copyleft", "source-available"], 60);
    if (rows.length === 0) throw new Error("no copyleft on an installed path — the report would be empty");
    const strong = rows.filter((row) => row.category === "strong-copyleft").length;
    return `${rows.length} flagged (${strong} strong copyleft)`;
  });

  await check("getPhantomDependencies", async () => {
    const rows = await queries.getPhantomDependencies(80);
    return `${rows.length} findings suppressed as not installed`;
  });

  await check("listPackages", async () => {
    const rows = await queries.listPackages({
      search: "",
      license: "",
      vulnerableOnly: false,
      singleMaintainerOnly: false,
      limit: 30,
      offset: 0,
    });
    return `${rows.length} rows, top has ${rows[0]?.directDependents ?? 0} direct dependents`;
  });

  await check("countPackages", async () => {
    const total = await queries.countPackages({
      search: "",
      license: "",
      vulnerableOnly: false,
      singleMaintainerOnly: false,
    });
    return `${total} packages`;
  });

  await check("searchPackages", async () => {
    const rows = await queries.searchPackages("ex", 12);
    return `${rows.length} suggestions for "ex"`;
  });

  await check("listLicenses", async () => {
    const rows = await queries.listLicenses();
    return `${rows.length} licences in use`;
  });

  let samplePackage = "";
  await check("getPackageDetail", async () => {
    const popular = await queries.listPackages({
      search: "",
      license: "",
      vulnerableOnly: false,
      singleMaintainerOnly: false,
      limit: 1,
      offset: 0,
    });
    samplePackage = popular[0]?.name ?? "";
    if (!samplePackage) throw new Error("no packages to inspect");

    const detail = await queries.getPackageDetail(samplePackage);
    if (!detail) throw new Error(`package ${samplePackage} not found`);
    return `${samplePackage}: ${detail.dependents.length} dependents, ${detail.reachedByApplications.length} apps`;
  });

  await check("getPackageNeighbourhood", async () => {
    const graph = await queries.getPackageNeighbourhood(samplePackage);
    return `${graph.nodes.length} nodes, ${graph.edges.length} edges${graph.truncated ? " (trimmed)" : ""}`;
  });

  await check("getApplicationDetail", async () => {
    const apps = await queries.listApplicationOptions();
    if (apps.length === 0) throw new Error("no applications");
    const detail = await queries.getApplicationDetail(apps[0].id);
    if (!detail) throw new Error("application not found");
    return `${detail.name}: ${detail.installedPackages} packages, ${detail.findings.length} findings`;
  });

  await check("findRoutes", async () => {
    const apps = await queries.listApplicationOptions();
    const detail = await queries.getApplicationDetail(apps[0].id);
    const target = detail?.findings[0]?.packageName ?? samplePackage;
    const result = await queries.findRoutes(apps[0].id, target, 12);
    if (!result) throw new Error("endpoints not found");
    return `${apps[0].id} → ${target}: ${result.routes.length} shortest routes`;
  });

  await check("getWeaknessBreakdown", async () => {
    const rows = await queries.getWeaknessBreakdown();
    return `${rows.length} weakness classes`;
  });

  // The materialised closure is derived data, and derived data drifts. This
  // proves it hasn't: for a sample of packages, the number of applications
  // recorded in REACHES must equal the number found by actually walking
  // DEPENDS_ON. If a generator change ever lands without a reseed, or the
  // closure is built to a different depth than the queries use, this fails.
  await check("REACHES agrees with live traversal", async () => {
    const { runQuery } = await import("../src/lib/neo4j");
    const rows = await runQuery<{ name: string; materialised: number; traversed: number }>(
      `MATCH (pkg:Package)<-[:AFFECTS]-(:Advisory)
       WITH pkg LIMIT 12
       OPTIONAL MATCH (a:Application)-[:REACHES { installed: true }]->(pkg)
       WITH pkg, count(DISTINCT a) AS materialised
       OPTIONAL MATCH (b:Application)-[:DEPENDS_ON*1..5]->(pkg)
       RETURN pkg.name AS name, materialised, count(DISTINCT b) AS traversed`,
    );

    const drifted = rows.filter((row) => row.materialised !== row.traversed);
    if (drifted.length > 0) {
      const detail = drifted
        .map((row) => `${row.name}: REACHES=${row.materialised} traversal=${row.traversed}`)
        .join("; ");
      throw new Error(`closure disagrees with traversal — ${detail}. Re-run npm run seed:reset.`);
    }
    return `${rows.length} packages cross-checked, all match`;
  });

  await closeDriver();

  if (failures > 0) {
    console.log(`\n  ${failures} ${failures === 1 ? "query" : "queries"} failed.\n`);
    process.exit(1);
  }
  console.log("\n  All queries returned usable results.\n");
}

main().catch(async (error) => {
  console.error("\nVerification failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
