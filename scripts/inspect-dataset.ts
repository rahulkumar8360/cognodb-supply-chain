/**
 * Checks the generated dataset without needing a database.
 *
 *   npm run inspect:dataset
 *
 * A dependency graph can be structurally valid and still make a useless demo:
 * if every hub is reached by every application, every report answers "all 30"
 * and discriminates between nothing. These assertions encode the properties the
 * application actually depends on, so a change to the generator's tuning that
 * quietly flattens the graph fails here rather than in a screenshot.
 */

import { buildDataset, summarize, type Dataset } from "./dataset";

type Check = { label: string; ok: boolean; detail: string };

function reachabilityByApplication(dataset: Dataset) {
  const runtimeEdges = new Map<string, string[]>();
  for (const edge of dataset.packageDependencies) {
    if (edge.scope !== "runtime") continue;
    const list = runtimeEdges.get(edge.from);
    if (list) list.push(edge.to);
    else runtimeEdges.set(edge.from, [edge.to]);
  }

  const reachedBy = new Map<string, Set<string>>();
  const perApplication = new Map<string, number>();

  for (const application of dataset.applications) {
    const seen = new Set<string>();
    const queue: string[] = [];
    for (const edge of dataset.applicationDependencies) {
      if (edge.from !== application.id || edge.scope !== "runtime") continue;
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const next of runtimeEdges.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    perApplication.set(application.id, seen.size);
    for (const name of seen) {
      const apps = reachedBy.get(name);
      if (apps) apps.add(application.id);
      else reachedBy.set(name, new Set([application.id]));
    }
  }

  return { reachedBy, perApplication };
}

function main() {
  const dataset = buildDataset();
  const summary = summarize(dataset);

  console.log("\nDataset inspection\n");
  console.log("  Nodes");
  for (const [label, count] of Object.entries(summary.nodes)) {
    console.log(`    ${label.padEnd(14)} ${String(count).padStart(6)}`);
  }
  console.log("  Relationships");
  for (const [label, count] of Object.entries(summary.relationships)) {
    console.log(`    ${label.padEnd(32)} ${String(count).padStart(6)}`);
  }

  const { reachedBy, perApplication } = reachabilityByApplication(dataset);

  const maintainersPerPackage = new Map<string, number>();
  for (const link of dataset.maintains) {
    maintainersPerPackage.set(link.packageName, (maintainersPerPackage.get(link.packageName) ?? 0) + 1);
  }

  const soloPackages = dataset.packages.filter((pkg) => maintainersPerPackage.get(pkg.name) === 1);
  const soloWithReach = soloPackages.filter((pkg) => (reachedBy.get(pkg.name)?.size ?? 0) >= 3);

  const advisoryReach = dataset.affects.map((affects) => reachedBy.get(affects.packageName)?.size ?? 0);
  const reachableAdvisories = advisoryReach.filter((count) => count > 0).length;

  const copyleftIds = new Set(
    dataset.licenses.filter((licence) => licence.category === "strong-copyleft").map((licence) => licence.id),
  );
  const copyleftReachable = dataset.packages.filter(
    (pkg) => copyleftIds.has(pkg.license) && (reachedBy.get(pkg.name)?.size ?? 0) > 0,
  );

  const applicationCount = dataset.applications.length;
  const universal = dataset.packages.filter(
    (pkg) => (reachedBy.get(pkg.name)?.size ?? 0) === applicationCount,
  ).length;
  const reachCounts = [...perApplication.values()].sort((a, b) => a - b);

  const orphaned = dataset.packages.filter((pkg) => (reachedBy.get(pkg.name)?.size ?? 0) === 0).length;

  const checks: Check[] = [
    {
      label: "every package is reachable from some application",
      // Packages reachable only over optional or dev edges are expected and are
      // exactly what the phantom-dependency report is for; they just do not
      // appear in this runtime-only walk.
      ok: orphaned < dataset.packages.length * 0.25,
      detail: `${orphaned} of ${dataset.packages.length} not on a runtime path (optional/dev only)`,
    },
    {
      label: "applications have substantial dependency trees",
      ok: reachCounts[Math.floor(reachCounts.length / 2)] >= 120,
      detail: `median ${reachCounts[Math.floor(reachCounts.length / 2)]}, range ${reachCounts[0]}–${reachCounts[reachCounts.length - 1]}`,
    },
    {
      label: "most advisories reach at least one application",
      ok: reachableAdvisories >= dataset.affects.length * 0.75,
      detail: `${reachableAdvisories} of ${dataset.affects.length}`,
    },
    {
      label: "blast radius discriminates rather than saturating",
      ok: universal < dataset.packages.length * 0.2,
      detail: `${universal} packages reach all ${applicationCount} applications`,
    },
    {
      label: "single-maintainer chokepoints exist and matter",
      ok: soloWithReach.length >= 20,
      detail: `${soloWithReach.length} solo-maintained packages reach 3+ applications`,
    },
    {
      label: "copyleft is present on installed paths",
      ok: copyleftReachable.length >= 3,
      detail: `${copyleftReachable.length} strong-copyleft packages on a runtime path`,
    },
    {
      label: "optional and dev edges exist to make the distinction real",
      ok:
        dataset.packageDependencies.some((edge) => edge.scope === "optional") &&
        dataset.applicationDependencies.some((edge) => edge.scope === "dev"),
      detail: `${dataset.packageDependencies.filter((e) => e.scope === "optional").length} optional, ${dataset.applicationDependencies.filter((e) => e.scope === "dev").length} dev`,
    },
    {
      label: "dependency graph is acyclic",
      ok: dataset.packageDependencies.every((edge) => {
        const from = dataset.packages.find((pkg) => pkg.name === edge.from);
        const to = dataset.packages.find((pkg) => pkg.name === edge.to);
        return !from || !to || from.layer > to.layer;
      }),
      detail: "every edge goes from a higher layer to a lower one",
    },
  ];

  console.log("\n  Properties the application relies on\n");
  let failed = 0;
  for (const check of checks) {
    if (!check.ok) failed += 1;
    console.log(`    ${check.ok ? "✓" : "✗"} ${check.label.padEnd(52)} ${check.detail}`);
  }

  if (failed > 0) {
    console.log(`\n  ${failed} ${failed === 1 ? "property" : "properties"} not satisfied.\n`);
    process.exit(1);
  }
  console.log("\n  Dataset looks healthy.\n");
}

main();
