import Link from "next/link";
import { Suspense } from "react";

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
  StatSkeleton,
  TableSkeleton,
  formatCompact,
  formatNumber,
} from "@/components/ui/primitives";
import { RetryableError } from "@/components/ui/retryable-error";
import { attempt } from "@/lib/attempt";
import {
  getApplicationExposure,
  getExposureSummary,
  getGraphTotals,
  getRiskiestPackages,
  getTeamExposure,
} from "@/lib/queries";

// Every page reads live from the database on each request. Caching a security
// dashboard would mean showing a reviewer a stale answer to "am I exposed?",
// which is the one question it must never get wrong.
export const dynamic = "force-dynamic";

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="What can reach production today"
        description={
          <>
            Meridian runs 30 services on top of a few thousand open-source packages that nobody chose
            directly. This page answers the only question that matters on a Monday morning: of everything
            in the advisory feed, what can actually be reached from something we ship — and how far away
            is it?
          </>
        }
      />

      <Suspense fallback={<StatRowSkeleton />}>
        <StatRow />
      </Suspense>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.45fr_1fr]">
        <Suspense fallback={<PanelSkeleton title="Exposure by application" columns={5} />}>
          <ApplicationExposurePanel />
        </Suspense>
        <div className="space-y-5">
          <Suspense fallback={<PanelSkeleton title="Fix these first" rows={6} columns={3} />}>
            <RiskiestPackagesPanel />
          </Suspense>
          <Suspense fallback={<PanelSkeleton title="Exposure by team" rows={6} columns={2} />}>
            <TeamExposurePanel />
          </Suspense>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------- stats --

async function StatRow() {
  const [totals, exposure] = await Promise.all([
    attempt(getGraphTotals),
    attempt(getExposureSummary),
  ]);

  if (!totals.ok) return <RetryableError error={totals.error} />;
  if (!exposure.ok) return <RetryableError error={exposure.error} />;

  const { critical, high, reachingProduction, notReachable } = exposure.data;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat
        label="Critical, reachable"
        value={critical}
        tone={critical > 0 ? "critical" : "safe"}
        hint={critical > 0 ? "On a path from at least one running service" : "Nothing critical is reachable"}
        href="/advisories?severity=critical"
      />
      <Stat
        label="High, reachable"
        value={high}
        tone={high > 0 ? "high" : "safe"}
        hint="Reached over installed dependencies only"
        href="/advisories?severity=high"
      />
      <Stat
        label="Advisories filtered out"
        value={notReachable}
        hint={`${reachingProduction} of ${reachingProduction + notReachable} in the feed reach something we run`}
        href="/advisories"
      />
      <Stat
        label="Packages in the graph"
        value={formatCompact(totals.data.packages)}
        hint={`${formatNumber(totals.data.dependencies)} dependency edges across ${totals.data.applications} applications`}
        href="/packages"
      />
    </div>
  );
}

function StatRowSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <StatSkeleton key={index} />
      ))}
    </div>
  );
}

// ------------------------------------------------- exposure by application --

async function ApplicationExposurePanel() {
  const result = await attempt(getApplicationExposure);

  if (!result.ok) {
    return (
      <Panel>
        <PanelHeader title="Exposure by application" />
        <div className="p-4">
          <RetryableError error={result.error} compact />
        </div>
      </Panel>
    );
  }

  const rows = result.data;

  return (
    <Panel>
      <PanelHeader
        title="Exposure by application"
        description="Ranked by severity of what is reachable, not by how many packages each service has."
        action={
          <Link href="/applications" className="text-[13px] text-accent hover:underline">
            All applications
          </Link>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No applications in the graph"
          description="Run npm run seed to load the demo dataset."
        />
      ) : (
        <div className="scroll-panel max-h-[560px] overflow-y-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-line text-[11px] uppercase tracking-[0.08em] text-ink-faint">
                <th scope="col" className="px-5 py-2.5 font-medium">Service</th>
                <th scope="col" className="px-2 py-2.5 text-right font-medium">Installed</th>
                <th scope="col" className="px-2 py-2.5 text-right font-medium" title="Critical">Crit</th>
                <th scope="col" className="px-2 py-2.5 text-right font-medium">High</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line/60 last:border-0 hover:bg-surface-hover">
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2">
                      <AppLink id={row.id} name={row.name} />
                      <CriticalityBadge criticality={row.criticality} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-ink-faint">{row.team}</p>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular text-ink-muted">
                    {formatNumber(row.installedPackages)}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular">
                    <span className={row.critical > 0 ? "font-semibold text-critical" : "text-ink-faint"}>
                      {row.critical}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular">
                    <span className={row.high > 0 ? "font-semibold text-high" : "text-ink-faint"}>
                      {row.high}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-right tabular text-ink">{row.advisories}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// --------------------------------------------------------- fix these first --

async function RiskiestPackagesPanel() {
  const result = await attempt(() => getRiskiestPackages(8));

  if (!result.ok) {
    return (
      <Panel>
        <PanelHeader title="Fix these first" />
        <div className="p-4">
          <RetryableError error={result.error} compact />
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader
        title="Fix these first"
        description="Vulnerable packages ordered by how many tier-1 services they sit underneath."
      />
      {result.data.length === 0 ? (
        <EmptyState
          icon="good"
          title="Nothing vulnerable is reachable"
          description="No advisory in the feed reaches a running service."
        />
      ) : (
        <ul className="divide-y divide-line/60">
          {result.data.map((pkg) => (
            <li key={pkg.name} className="flex items-start justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <PackageLink name={pkg.name} />
                  <SeverityBadge severity={pkg.worstSeverity} />
                  {pkg.maintainerCount === 1 ? (
                    <Badge tone="warn" title="A single account can publish to this package">
                      bus factor 1
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-ink-faint">
                  {pkg.advisories} {pkg.advisories === 1 ? "advisory" : "advisories"} ·{" "}
                  {formatCompact(pkg.weeklyDownloads)} weekly downloads
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular text-ink">{pkg.applicationsReached}</p>
                <p className="text-[11px] text-ink-faint">
                  {pkg.tierOneReached > 0 ? `${pkg.tierOneReached} tier-1` : "services"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------ team roll-up --

async function TeamExposurePanel() {
  const result = await attempt(getTeamExposure);

  if (!result.ok) {
    return (
      <Panel>
        <PanelHeader title="Exposure by team" />
        <div className="p-4">
          <RetryableError error={result.error} compact />
        </div>
      </Panel>
    );
  }

  const rows = result.data;
  const max = Math.max(1, ...rows.map((row) => row.critical + row.high + row.moderate + row.low));

  return (
    <Panel>
      <PanelHeader title="Exposure by team" description="Who owns the work." />
      {rows.length === 0 ? (
        <EmptyState title="No teams to show" />
      ) : (
        <ul className="space-y-2.5 px-5 py-4">
          {rows.map((row) => {
            const total = row.critical + row.high + row.moderate + row.low;
            return (
              <li key={row.team}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-medium text-ink">{row.team}</span>
                  <span className="text-[11px] tabular text-ink-faint">
                    {row.applications} {row.applications === 1 ? "service" : "services"} · {total}
                  </span>
                </div>
                {/* A stacked bar rather than four numbers: the mix of severities
                    is the point, and the eye reads proportion faster than it
                    reads a row of digits. */}
                <div
                  className="flex h-1.5 gap-px overflow-hidden rounded-full bg-surface-raised"
                  role="img"
                  aria-label={`${row.critical} critical, ${row.high} high, ${row.moderate} moderate, ${row.low} low`}
                >
                  {(
                    [
                      ["critical", row.critical, "bg-critical"],
                      ["high", row.high, "bg-high"],
                      ["moderate", row.moderate, "bg-moderate"],
                      ["low", row.low, "bg-low"],
                    ] as const
                  ).map(([key, count, colour]) =>
                    count > 0 ? (
                      <span key={key} className={colour} style={{ width: `${(count / max) * 100}%` }} />
                    ) : null,
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function PanelSkeleton({ title, rows = 10, columns = 4 }: { title: string; rows?: number; columns?: number }) {
  return (
    <Panel>
      <PanelHeader title={title} />
      <TableSkeleton rows={rows} columns={columns} />
    </Panel>
  );
}
