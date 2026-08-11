import { Suspense } from "react";

import { ChoiceGroup, Pagination, SearchInput, ToggleFilter } from "@/components/filters";
import {
  AdvisoryLink,
  Badge,
  EmptyState,
  PackageLink,
  Panel,
  PageHeader,
  SeverityBadge,
  TableSkeleton,
  formatAge,
} from "@/components/ui/primitives";
import { RetryableError } from "@/components/ui/retryable-error";
import { attempt } from "@/lib/attempt";
import { countAdvisories, listAdvisories } from "@/lib/queries";
import type { Severity } from "@/lib/queries/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Advisories" };

const PAGE_SIZE = 25;
const SEVERITIES: Severity[] = ["critical", "high", "moderate", "low"];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readParams(params: Record<string, string | string[] | undefined>) {
  const severity = typeof params.severity === "string" ? params.severity : "";
  const page = Math.max(1, Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1);
  return {
    // The severity filter is validated against the known set rather than passed
    // through. Cypher parameters make injection impossible either way, but an
    // unknown value would silently return an empty table, which reads as a bug.
    severities: SEVERITIES.includes(severity as Severity) ? [severity as Severity] : [],
    search: typeof params.q === "string" ? params.q : "",
    exposedOnly: params.exposed === "1",
    page,
  };
}

export default async function AdvisoriesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filter = readParams(params);

  return (
    <>
      <PageHeader
        eyebrow="Advisories"
        title="The feed, filtered to what we actually run"
        description="Every advisory against a package somewhere in Meridian's dependency graph, ranked by how many services it can reach over installed dependencies. Open one to see the exact route in."
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <SearchInput placeholder="Search by CVE, package or summary" className="min-w-[240px] flex-1" />
          <ChoiceGroup
            label="Severity"
            paramName="severity"
            options={SEVERITIES.map((value) => ({ value, label: value, tone: value }))}
          />
          <ToggleFilter
            paramName="exposed"
            label="Reachable only"
            title="Hide advisories that no application can reach"
          />
        </div>

        <Suspense key={JSON.stringify(filter)} fallback={<TableSkeleton rows={10} columns={5} />}>
          <AdvisoryTable filter={filter} />
        </Suspense>
      </Panel>
    </>
  );
}

async function AdvisoryTable({ filter }: { filter: ReturnType<typeof readParams> }) {
  const [rows, total] = await Promise.all([
    attempt(() =>
      listAdvisories({
        severities: filter.severities,
        search: filter.search,
        exposedOnly: filter.exposedOnly,
        limit: PAGE_SIZE,
        offset: (filter.page - 1) * PAGE_SIZE,
      }),
    ),
    attempt(() => countAdvisories({ severities: filter.severities, search: filter.search })),
  ]);

  if (!rows.ok) {
    return (
      <div className="p-4">
        <RetryableError error={rows.error} compact />
      </div>
    );
  }

  if (rows.data.length === 0) {
    const filtered = filter.search !== "" || filter.severities.length > 0 || filter.exposedOnly;
    return (
      <EmptyState
        icon={filtered ? "search" : "good"}
        title={filtered ? "No advisories match these filters" : "Nothing in the feed"}
        description={
          filtered
            ? "Try clearing the severity filter or the search box."
            : "Run npm run seed to load the demo dataset."
        }
      />
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-[0.08em] text-ink-faint">
              <th scope="col" className="px-5 py-2.5 font-medium">Advisory</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Package</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Fixed in</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">CVSS</th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">Reaches</th>
            </tr>
          </thead>
          <tbody>
            {rows.data.map((row) => (
              <tr key={row.id} className="border-b border-line/60 last:border-0 align-top hover:bg-surface-hover">
                <td className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <AdvisoryLink id={row.id} />
                    <SeverityBadge severity={row.severity} />
                    {row.simulated ? (
                      <Badge tone="quiet" title="Generated for this demo, not a real published advisory">
                        simulated
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-ink-muted">{row.summary}</p>
                  <p className="mt-1 text-[11px] text-ink-faint">
                    {row.cwe} · published {formatAge(row.publishedAt)}
                  </p>
                </td>
                <td className="px-3 py-3">
                  <PackageLink name={row.packageName} />
                  <p className="mt-0.5 font-mono text-[11px] text-ink-faint">{row.vulnerableRange}</p>
                </td>
                <td className="px-3 py-3 font-mono text-[12px] text-safe">{row.patchedIn}</td>
                <td className="px-3 py-3 text-right tabular text-ink-muted">{row.cvss.toFixed(1)}</td>
                <td className="px-5 py-3 text-right">
                  {row.exposedApplications === 0 ? (
                    <Badge tone="good">not reachable</Badge>
                  ) : (
                    <>
                      <p className="text-sm font-semibold tabular text-ink">{row.exposedApplications}</p>
                      <p className="text-[11px] text-ink-faint">
                        {row.tierOneExposed > 0 ? `${row.tierOneExposed} tier-1` : "services"}
                      </p>
                    </>
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
