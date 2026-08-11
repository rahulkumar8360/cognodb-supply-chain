import {
  AppLink,
  Badge,
  CriticalityBadge,
  EmptyState,
  PackageLink,
  Panel,
  PanelHeader,
  PageHeader,
  SeverityBadge,
  Stat,
} from "@/components/ui/primitives";
import { RetryableError } from "@/components/ui/retryable-error";
import { attempt } from "@/lib/attempt";
import { getPhantomDependencies } from "@/lib/queries";
import type { Severity } from "@/lib/queries/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Phantom dependencies" };

export default async function PhantomPage() {
  const result = await attempt(() => getPhantomDependencies(80));

  const critical = result.ok ? result.data.filter((row) => row.worstSeverity === "critical").length : 0;
  const tierOne = result.ok ? result.data.filter((row) => row.criticality === "tier-1").length : 0;

  return (
    <>
      <PageHeader
        eyebrow="Phantom dependencies"
        title="Declared, but never installed"
        description={
          <>
            Every route to these packages runs through an optional or dev dependency, so they appear in
            the dependency tree but not in the shipped artifact. A scanner that ignores the distinction
            will page someone at 3am about a critical vulnerability in code that was never deployed.
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Findings suppressed"
          value={result.ok ? result.data.length : "—"}
          tone="moderate"
          hint="Vulnerable packages that are not actually installed"
        />
        <Stat
          label="Would have been critical"
          value={critical}
          tone={critical > 0 ? "moderate" : "safe"}
          hint="Critical alerts avoided by checking the path"
        />
        <Stat
          label="On tier-1 services"
          value={tierOne}
          hint="Where a false page costs the most"
        />
      </div>

      <Panel className="mt-6">
        <PanelHeader
          title="Suppressed findings"
          description="Computed as a set difference between two transitive closures over the same nodes: everything declared, minus everything reachable over runtime edges alone."
        />

        {!result.ok ? (
          <div className="p-4">
            <RetryableError error={result.error} compact />
          </div>
        ) : result.data.length === 0 ? (
          <EmptyState
            icon="good"
            title="No phantom dependencies"
            description="Every vulnerable package in the graph is genuinely installed by the services that reach it — there is nothing here to filter out."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.08em] text-ink-faint">
                  <th scope="col" className="px-5 py-2.5 font-medium">Service</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Package</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Declared at</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">Advisories</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((row) => (
                  <tr
                    key={`${row.applicationId}-${row.packageName}`}
                    className="border-b border-line/60 last:border-0 hover:bg-surface-hover"
                  >
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <AppLink id={row.applicationId} name={row.applicationName} />
                        <CriticalityBadge criticality={row.criticality} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <PackageLink name={row.packageName} />
                      <span className="ml-2 font-mono text-[11px] text-ink-faint">v{row.packageVersion}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular text-ink-muted">
                      {row.declaredHops} {row.declaredHops === 1 ? "hop" : "hops"}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="tabular text-ink-muted">{row.advisories}</span>
                        <SeverityBadge severity={row.worstSeverity as Severity | null} />
                        <Badge tone="good" title="Not installed, so not exploitable in production">
                          not shipped
                        </Badge>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
