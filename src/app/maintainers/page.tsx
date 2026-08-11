import { Suspense } from "react";

import { ToggleFilter } from "@/components/filters";
import {
  Badge,
  EmptyState,
  PackageLink,
  Panel,
  PanelHeader,
  PageHeader,
  TableSkeleton,
  formatAge,
  formatCompact,
} from "@/components/ui/primitives";
import { RetryableError } from "@/components/ui/retryable-error";
import { attempt } from "@/lib/attempt";
import { getChokepoints, getTakeoverRisk } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Maintainer risk" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MaintainersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const requireNo2FA = params.no2fa === "1";
  const minApplications = params.wide === "1" ? 10 : 3;

  return (
    <>
      <PageHeader
        eyebrow="Maintainer risk"
        title="Who can push code into production"
        description={
          <>
            A dependency is a standing invitation for someone you have never met to run code on your
            servers. These two reports ask who that is. Both are two-hop questions — maintainer to package
            to service — that only have an answer once you traverse them.
          </>
        }
      />

      <Panel>
        <PanelHeader
          title="Single-maintainer chokepoints"
          description="Packages that reach several services and are controlled by exactly one account. This is the shape event-stream, ua-parser-js and node-ipc all had before they became incidents."
          action={<ToggleFilter paramName="wide" label="Reaches 10+ services" />}
        />
        <Suspense key={`choke-${minApplications}`} fallback={<TableSkeleton rows={8} columns={5} />}>
          <ChokepointTable minApplications={minApplications} />
        </Suspense>
      </Panel>

      <Panel className="mt-5">
        <PanelHeader
          title="If this account were compromised"
          description="Accounts ranked by the number of services their packages transitively reach — the set union across everything they maintain, not just their biggest package."
          action={<ToggleFilter paramName="no2fa" label="No 2FA only" />}
        />
        <Suspense key={`takeover-${requireNo2FA}`} fallback={<TableSkeleton rows={8} columns={4} />}>
          <TakeoverTable requireNo2FA={requireNo2FA} />
        </Suspense>
      </Panel>
    </>
  );
}

async function ChokepointTable({ minApplications }: { minApplications: number }) {
  const result = await attempt(() => getChokepoints(minApplications, 25));

  if (!result.ok) {
    return (
      <div className="p-4">
        <RetryableError error={result.error} compact />
      </div>
    );
  }

  if (result.data.length === 0) {
    return (
      <EmptyState
        icon="good"
        title="No single-maintainer chokepoints at this threshold"
        description={`No package reaching ${minApplications} or more services is maintained by a single account.`}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-[0.08em] text-ink-faint">
            <th scope="col" className="px-5 py-2.5 font-medium">Package</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Sole maintainer</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">Also owns</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">Closest</th>
            <th scope="col" className="px-5 py-2.5 text-right font-medium">Services</th>
          </tr>
        </thead>
        <tbody>
          {result.data.map((row) => (
            <tr key={row.packageName} className="border-b border-line/60 last:border-0 hover:bg-surface-hover">
              <td className="px-5 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <PackageLink name={row.packageName} />
                  {row.deprecated ? <Badge tone="warn">deprecated</Badge> : null}
                </div>
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  {formatCompact(row.weeklyDownloads)}/wk · published {formatAge(row.lastPublished)}
                </p>
              </td>
              <td className="px-3 py-2.5">
                <p className="text-[13px] text-ink">{row.maintainerName}</p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="font-mono text-[11px] text-ink-faint">@{row.maintainerUsername}</span>
                  {row.twoFactorEnabled ? null : <Badge tone="danger">no 2FA</Badge>}
                </div>
              </td>
              <td className="px-3 py-2.5 text-right tabular text-ink-muted" title="Other packages the same account controls">
                {row.alsoMaintains}
              </td>
              <td className="px-3 py-2.5 text-right tabular text-ink-muted">
                {row.shortestHops} {row.shortestHops === 1 ? "hop" : "hops"}
              </td>
              <td className="px-5 py-2.5 text-right">
                <p className="text-sm font-semibold tabular text-ink">{row.applicationsReached}</p>
                {row.tierOneReached > 0 ? (
                  <p className="text-[11px] font-medium text-critical">{row.tierOneReached} tier-1</p>
                ) : (
                  <p className="text-[11px] text-ink-faint">services</p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function TakeoverTable({ requireNo2FA }: { requireNo2FA: boolean }) {
  const result = await attempt(() => getTakeoverRisk({ requireNo2FA, limit: 20 }));

  if (!result.ok) {
    return (
      <div className="p-4">
        <RetryableError error={result.error} compact />
      </div>
    );
  }

  if (result.data.length === 0) {
    return (
      <EmptyState
        icon="good"
        title="Nothing to report"
        description={
          requireNo2FA
            ? "Every account whose packages reach a service has two-factor authentication enabled."
            : "No maintainer's packages reach a running service."
        }
      />
    );
  }

  return (
    <ul className="divide-y divide-line/60">
      {result.data.map((row) => (
        <li key={row.username} className="flex flex-wrap items-start justify-between gap-4 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium text-ink">{row.name}</span>
              <span className="font-mono text-[11px] text-ink-faint">@{row.username}</span>
              {row.twoFactorEnabled ? (
                <Badge tone="good">2FA</Badge>
              ) : (
                <Badge tone="danger">no 2FA</Badge>
              )}
              {row.daysSinceLastPublish > 730 ? (
                <Badge tone="warn" title="Dormant accounts are the ones that get taken over">
                  dormant {Math.round(row.daysSinceLastPublish / 365)}y
                </Badge>
              ) : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-ink-faint">
                {row.packagesOwned} {row.packagesOwned === 1 ? "package" : "packages"}, of which{" "}
                {row.packagesReachable} we install:
              </span>
              {row.topPackages.map((name) => (
                <PackageLink key={name} name={name} className="text-[11px]" />
              ))}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-lg font-semibold tabular text-ink">{row.applicationsReached}</p>
            {row.tierOneReached > 0 ? (
              <p className="text-[11px] font-medium text-critical">{row.tierOneReached} tier-1</p>
            ) : (
              <p className="text-[11px] text-ink-faint">services</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
