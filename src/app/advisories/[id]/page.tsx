import Link from "next/link";
import { notFound } from "next/navigation";

import { RouteTrail } from "@/components/route-trail";
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
  formatAge,
} from "@/components/ui/primitives";
import { RetryableError } from "@/components/ui/retryable-error";
import { attempt } from "@/lib/attempt";
import { getBlastRadius } from "@/lib/queries";

export const dynamic = "force-dynamic";

const DEFAULT_MAX_DEPTH = 5;

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  return { title: `${decodeURIComponent(id)} blast radius` };
}

export default async function BlastRadiusPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const query = await searchParams;
  const advisoryId = decodeURIComponent(id);

  const requestedDepth = Number.parseInt(typeof query.depth === "string" ? query.depth : "", 10);
  const maxDepth = Number.isInteger(requestedDepth) && requestedDepth >= 1 && requestedDepth <= 5
    ? requestedDepth
    : DEFAULT_MAX_DEPTH;

  const result = await attempt(() => getBlastRadius(advisoryId, maxDepth));

  if (!result.ok) {
    return (
      <>
        <PageHeader eyebrow="Blast radius" title={advisoryId} />
        <RetryableError error={result.error} />
      </>
    );
  }

  if (!result.data) notFound();

  const { advisory, packageName, packageVersion, vulnerableRange, patchedIn, rows } = result.data;
  const installed = rows.filter((row) => !row.declaredOnly);
  const declaredOnly = rows.filter((row) => row.declaredOnly);
  const tierOne = installed.filter((row) => row.criticality === "tier-1");
  const directHits = installed.filter((row) => row.installedHops === 1);

  return (
    <>
      <PageHeader
        eyebrow="Blast radius"
        title={advisory.id}
        description={advisory.summary}
        actions={
          <Link
            href="/advisories"
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            Back to feed
          </Link>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <SeverityBadge severity={advisory.severity} />
        <Badge tone="neutral">CVSS {advisory.cvss.toFixed(1)}</Badge>
        <Badge tone="neutral">{advisory.cwe}</Badge>
        <Badge tone="quiet">published {formatAge(advisory.publishedAt)}</Badge>
        {advisory.simulated ? (
          <Badge tone="quiet" title="Generated for this demo rather than a real published advisory">
            simulated advisory
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Services exposed"
          value={installed.length}
          tone={installed.length > 0 ? "critical" : "safe"}
          hint="Reachable over installed dependencies"
        />
        <Stat
          label="Tier-1 exposed"
          value={tierOne.length}
          tone={tierOne.length > 0 ? "critical" : "safe"}
          hint="Revenue-critical services"
        />
        <Stat
          label="Direct dependencies"
          value={directHits.length}
          tone={directHits.length > 0 ? "high" : "safe"}
          hint={
            directHits.length > 0
              ? "Fixable by editing the service's own package.json"
              : "Every route is inherited from a dependency"
          }
        />
        <Stat
          label="Declared, not installed"
          value={declaredOnly.length}
          tone="moderate"
          hint="Only reachable through an optional or dev dependency"
        />
      </div>

      <Panel className="mt-6">
        <PanelHeader
          title="The vulnerable package"
          description="Everything below is a route that ends here."
        />
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <PackageLink name={packageName} className="text-base" />
            <p className="mt-1 text-[12px] text-ink-muted">
              Installed version <span className="font-mono text-ink">{packageVersion}</span> · vulnerable range{" "}
              <span className="font-mono text-critical">{vulnerableRange}</span>
            </p>
          </div>
          <div className="rounded-lg border border-safe/25 bg-safe-wash px-3 py-2">
            <p className="text-[11px] uppercase tracking-[0.08em] text-safe/80">Patched in</p>
            <p className="font-mono text-sm font-semibold text-safe">{patchedIn}</p>
          </div>
        </div>
      </Panel>

      <Panel className="mt-5">
        <PanelHeader
          title="How it gets in"
          description={
            <>
              The shortest route from each service to the vulnerable package, found with a single{" "}
              <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[12px] text-ink-muted">
                shortestPath
              </code>{" "}
              traversal. Dashed arrows are optional or dev-only hops.
            </>
          }
          action={<DepthControl advisoryId={advisory.id} current={maxDepth} />}
        />

        {rows.length === 0 ? (
          <EmptyState
            icon="good"
            title="Nothing we run can reach this"
            description={`No application has a dependency path to ${packageName} within ${maxDepth} hops. This advisory is real, but it is not our problem today.`}
          />
        ) : (
          <ul className="divide-y divide-line/60">
            {rows.map((row) => (
              <li key={row.applicationId} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <AppLink id={row.applicationId} name={row.applicationName} />
                  <CriticalityBadge criticality={row.criticality} />
                  <span className="text-[11px] text-ink-faint">{row.team}</span>
                  {row.declaredOnly ? (
                    <Badge tone="warn" title="Every route runs through an optional or dev dependency">
                      not installed
                    </Badge>
                  ) : row.installedHops === 1 ? (
                    <Badge tone="danger">direct dependency</Badge>
                  ) : (
                    <Badge tone="neutral">{row.installedHops} hops</Badge>
                  )}
                </div>
                <RouteTrail steps={row.route} className="mt-2" />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

/**
 * Hop-count control.
 *
 * The upper bound of a variable-length pattern has to be a literal in Cypher,
 * so the query always walks up to five hops and this filters the results on
 * `length(path)`, which is a genuine parameter. Rendered as links rather than a
 * client component so the depth stays in the URL and the page keeps working
 * without JavaScript.
 */
function DepthControl({ advisoryId, current }: { advisoryId: string; current: number }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Maximum hops">
      <span className="mr-1 text-[11px] text-ink-faint">Max hops</span>
      {[1, 2, 3, 4, 5].map((depth) => (
        <Link
          key={depth}
          href={`/advisories/${encodeURIComponent(advisoryId)}?depth=${depth}`}
          scroll={false}
          aria-current={depth === current ? "true" : undefined}
          className={
            depth === current
              ? "rounded border border-accent/40 bg-accent-wash px-2 py-0.5 text-[12px] font-medium tabular text-accent"
              : "rounded border border-transparent px-2 py-0.5 text-[12px] tabular text-ink-faint transition-colors hover:text-ink-muted"
          }
        >
          {depth}
        </Link>
      ))}
    </div>
  );
}
