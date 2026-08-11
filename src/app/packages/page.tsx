import { Suspense } from "react";

import { Pagination, SearchInput, SelectFilter, ToggleFilter } from "@/components/filters";
import {
  Badge,
  EmptyState,
  PackageLink,
  Panel,
  PageHeader,
  SeverityBadge,
  TableSkeleton,
  formatCompact,
} from "@/components/ui/primitives";
import { RetryableError } from "@/components/ui/retryable-error";
import { attempt } from "@/lib/attempt";
import { countPackages, listLicenses, listPackages } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Packages" };

const PAGE_SIZE = 30;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PackagesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filter = {
    search: typeof params.q === "string" ? params.q : "",
    license: typeof params.license === "string" ? params.license : "",
    vulnerableOnly: params.vulnerable === "1",
    singleMaintainerOnly: params.solo === "1",
    page: Math.max(1, Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1),
  };

  const licenses = await attempt(listLicenses);

  return (
    <>
      <PageHeader
        eyebrow="Packages"
        title="Every package in the tree"
        description="Not a registry mirror — only packages at least one Meridian service actually pulls in, at any depth. Sorted by how many things depend on them, because that is what makes a package load-bearing."
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <SearchInput placeholder="Search package names" className="min-w-[220px] flex-1" />
          {licenses.ok ? (
            <SelectFilter
              paramName="license"
              label="Licence"
              placeholder="Any licence"
              options={licenses.data.map((licence) => ({
                value: licence.id,
                label: `${licence.id} (${licence.packages})`,
              }))}
            />
          ) : null}
          <ToggleFilter paramName="vulnerable" label="Has advisory" />
          <ToggleFilter
            paramName="solo"
            label="Bus factor 1"
            title="Only packages maintained by a single account"
          />
        </div>

        <Suspense key={JSON.stringify(filter)} fallback={<TableSkeleton rows={12} columns={5} />}>
          <PackageTable filter={filter} />
        </Suspense>
      </Panel>
    </>
  );
}

async function PackageTable({
  filter,
}: {
  filter: {
    search: string;
    license: string;
    vulnerableOnly: boolean;
    singleMaintainerOnly: boolean;
    page: number;
  };
}) {
  const [rows, total] = await Promise.all([
    attempt(() =>
      listPackages({
        search: filter.search,
        license: filter.license,
        vulnerableOnly: filter.vulnerableOnly,
        singleMaintainerOnly: filter.singleMaintainerOnly,
        limit: PAGE_SIZE,
        offset: (filter.page - 1) * PAGE_SIZE,
      }),
    ),
    attempt(() =>
      countPackages({
        search: filter.search,
        license: filter.license,
        vulnerableOnly: filter.vulnerableOnly,
        singleMaintainerOnly: filter.singleMaintainerOnly,
      }),
    ),
  ]);

  if (!rows.ok) {
    return (
      <div className="p-4">
        <RetryableError error={rows.error} compact />
      </div>
    );
  }

  if (rows.data.length === 0) {
    return (
      <EmptyState
        icon="search"
        title="No packages match these filters"
        description="Try a shorter search term, or clear the licence and bus-factor filters."
      />
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-[0.08em] text-ink-faint">
              <th scope="col" className="px-5 py-2.5 font-medium">Package</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Licence</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Downloads</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Dependents</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Maintainers</th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">Advisories</th>
            </tr>
          </thead>
          <tbody>
            {rows.data.map((pkg) => (
              <tr key={pkg.name} className="border-b border-line/60 last:border-0 hover:bg-surface-hover">
                <td className="px-5 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <PackageLink name={pkg.name} />
                    <span className="font-mono text-[11px] text-ink-faint">{pkg.version}</span>
                    {pkg.deprecated ? <Badge tone="warn">deprecated</Badge> : null}
                  </div>
                  <p className="mt-0.5 max-w-md truncate text-[11px] text-ink-faint">{pkg.description}</p>
                </td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-ink-muted">{pkg.license}</td>
                <td className="px-3 py-2.5 text-right tabular text-ink-muted">
                  {formatCompact(pkg.weeklyDownloads)}
                </td>
                <td className="px-3 py-2.5 text-right tabular text-ink-muted">{pkg.directDependents}</td>
                <td className="px-3 py-2.5 text-right tabular">
                  {pkg.maintainerCount === 1 ? (
                    <span className="font-semibold text-moderate" title="A single account can publish here">
                      1
                    </span>
                  ) : (
                    <span className="text-ink-muted">{pkg.maintainerCount}</span>
                  )}
                </td>
                <td className="px-5 py-2.5 text-right">
                  {pkg.advisories > 0 ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="tabular text-ink">{pkg.advisories}</span>
                      <SeverityBadge severity={pkg.worstSeverity} />
                    </span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total.ok ? <Pagination total={total.data} pageSize={PAGE_SIZE} page={filter.page} /> : null}
    </>
  );
}
