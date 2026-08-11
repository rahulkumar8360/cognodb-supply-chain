import {
  Badge,
  EmptyState,
  PackageLink,
  Panel,
  PanelHeader,
  PageHeader,
  Stat,
} from "@/components/ui/primitives";
import { RetryableError } from "@/components/ui/retryable-error";
import { attempt } from "@/lib/attempt";
import { getLicenseExposure, listLicenses } from "@/lib/queries";
import type { LicenseCategory } from "@/lib/queries/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Licence exposure" };

const WATCHED: LicenseCategory[] = ["strong-copyleft", "weak-copyleft", "source-available"];

const CATEGORY_COPY: Record<string, { label: string; tone: "danger" | "warn" | "neutral"; note: string }> = {
  "strong-copyleft": {
    label: "Strong copyleft",
    tone: "danger",
    note: "Distributing a work that links this may oblige you to publish your own source.",
  },
  "weak-copyleft": {
    label: "Weak copyleft",
    tone: "warn",
    note: "Modifications to the component itself must be published; your own code generally need not be.",
  },
  "source-available": {
    label: "Source available",
    tone: "warn",
    note: "Not an open-source licence. Commercial use is usually restricted by terms.",
  },
};

export default async function LicensesPage() {
  const [exposure, licenses] = await Promise.all([
    attempt(() => getLicenseExposure(WATCHED, 60)),
    attempt(listLicenses),
  ]);

  const strong = exposure.ok
    ? exposure.data.filter((row) => row.category === "strong-copyleft")
    : [];
  const tierOne = exposure.ok ? exposure.data.filter((row) => row.tierOneReached > 0) : [];

  return (
    <>
      <PageHeader
        eyebrow="Licence exposure"
        title="Copyleft on a shipping path"
        description={
          <>
            A GPL package pulled in as a build tool carries no distribution obligation. The same package
            four levels down a runtime tree very much does. That distinction is a property of the{" "}
            <em>path</em>, not of the package — so this report only counts routes made entirely of
            installed dependencies.
          </>
        }
      />

      {!exposure.ok ? (
        <RetryableError error={exposure.error} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Strong copyleft"
              value={strong.length}
              tone={strong.length > 0 ? "critical" : "safe"}
              hint="GPL / AGPL on an installed path"
            />
            <Stat
              label="Reaching tier-1"
              value={tierOne.length}
              tone={tierOne.length > 0 ? "high" : "safe"}
              hint="Under a revenue-critical service"
            />
            <Stat label="Flagged packages" value={exposure.data.length} hint="Across all watched categories" />
            <Stat
              label="Licences in use"
              value={licenses.ok ? licenses.data.length : "—"}
              hint="Distinct SPDX identifiers in the graph"
            />
          </div>

          <Panel className="mt-6">
            <PanelHeader
              title="Findings"
              description="Each row shows the shortest fully-installed route from a service to the licensed package."
            />
            {exposure.data.length === 0 ? (
              <EmptyState
                icon="good"
                title="Nothing to report"
                description="No copyleft or source-available package is reachable from a service over installed dependencies."
              />
            ) : (
              <ul className="divide-y divide-line/60">
                {exposure.data.map((row) => {
                  const copy = CATEGORY_COPY[row.category] ?? {
                    label: row.category,
                    tone: "neutral" as const,
                    note: "",
                  };
                  return (
                    <li key={`${row.licenseId}-${row.packageName}`} className="px-5 py-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <PackageLink name={row.packageName} />
                        <span className="font-mono text-[11px] text-ink-faint">v{row.packageVersion}</span>
                        <Badge tone={copy.tone} title={row.licenseName}>
                          {row.licenseId}
                        </Badge>
                        <Badge tone="quiet">{copy.label}</Badge>
                        <span className="text-[11px] text-ink-faint">
                          {row.applicationsReached} {row.applicationsReached === 1 ? "service" : "services"}
                          {row.tierOneReached > 0 ? (
                            <span className="ml-1 font-medium text-critical">({row.tierOneReached} tier-1)</span>
                          ) : null}
                        </span>
                      </div>

                      {/* The route is the evidence. Without it this is an
                          assertion; with it, a lawyer can check the claim. */}
                      <p className="mt-1.5 flex flex-wrap items-center gap-1 font-mono text-[11px] text-ink-muted">
                        {row.exampleRoute.map((step, index) => (
                          <span key={`${step}-${index}`} className="flex items-center gap-1">
                            {index > 0 ? <span className="text-ink-faint">→</span> : null}
                            <span className={index === row.exampleRoute.length - 1 ? "text-moderate" : undefined}>
                              {step}
                            </span>
                          </span>
                        ))}
                      </p>

                      {copy.note ? <p className="mt-1 text-[11px] text-ink-faint">{copy.note}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </>
      )}

      {licenses.ok ? (
        <Panel className="mt-5">
          <PanelHeader title="Licence mix" description="Every licence in the graph and how many packages use it." />
          <ul className="flex flex-wrap gap-2 px-5 py-4">
            {licenses.data.map((licence) => (
              <li
                key={licence.id}
                className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5"
              >
                <span className="font-mono text-[12px] text-ink">{licence.id}</span>
                <span className="text-[11px] tabular text-ink-faint">{licence.packages}</span>
                {licence.category !== "permissive" ? (
                  <Badge tone={licence.category === "strong-copyleft" ? "danger" : "warn"}>
                    {licence.category.replace("-", " ")}
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}
