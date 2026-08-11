import Link from "next/link";
import { notFound } from "next/navigation";

import { RouteTrail } from "@/components/route-trail";
import {
  AdvisoryLink,
  Badge,
  CriticalityBadge,
  EmptyState,
  PackageLink,
  Panel,
  PanelHeader,
  PageHeader,
  SeverityBadge,
  Stat,
  formatCompact,
} from "@/components/ui/primitives";
import { RetryableError } from "@/components/ui/retryable-error";
import { attempt } from "@/lib/attempt";
import { getApplicationDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  return { title: decodeURIComponent(id) };
}

export default async function ApplicationPage({ params }: { params: Params }) {
  const { id } = await params;
  const applicationId = decodeURIComponent(id);
  const result = await attempt(() => getApplicationDetail(applicationId));

  if (!result.ok) {
    return (
      <>
        <PageHeader eyebrow="Application" title={applicationId} />
        <RetryableError error={result.error} />
      </>
    );
  }

  if (!result.data) notFound();

  const app = result.data;
  const installedFindings = app.findings.filter((finding) => !finding.declaredOnly);
  const critical = installedFindings.filter((finding) => finding.severity === "critical").length;
  const high = installedFindings.filter((finding) => finding.severity === "high").length;
  const directFixes = installedFindings.filter((finding) => finding.hops === 1).length;

  return (
    <>
      <PageHeader
        eyebrow={`${app.team} · ${app.environment}`}
        title={app.name}
        description={app.description}
        actions={
          <>
            <CriticalityBadge criticality={app.criticality} />
            <Link
              href="/applications"
              className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              All applications
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Packages installed"
          value={app.installedPackages}
          hint={`from ${app.directDependencies.filter((dep) => dep.scope === "runtime").length} direct dependencies`}
        />
        <Stat
          label="Critical reachable"
          value={critical}
          tone={critical > 0 ? "critical" : "safe"}
          hint="Over installed dependencies"
        />
        <Stat label="High reachable" value={high} tone={high > 0 ? "high" : "safe"} />
        <Stat
          label="Fixable here"
          value={directFixes}
          tone={directFixes > 0 ? "moderate" : "safe"}
          hint="Findings in this service's own package.json"
        />
      </div>

      <Panel className="mt-6">
        <PanelHeader
          title="Findings"
          description="Every advisory reachable from this service, closest first. The route shows what to change and where."
        />
        {app.findings.length === 0 ? (
          <EmptyState
            icon="good"
            title="Nothing reachable"
            description="No advisory in the feed can be reached from this service's dependency tree."
          />
        ) : (
          <ul className="divide-y divide-line/60">
            {app.findings.map((finding) => (
              <li key={`${finding.id}-${finding.packageName}`} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <AdvisoryLink id={finding.id} />
                  <SeverityBadge severity={finding.severity} />
                  <span className="text-[12px] text-ink-muted">
                    in <PackageLink name={finding.packageName} />
                  </span>
                  <Badge tone="good" title="The first version that is not affected">
                    fix: {finding.patchedIn}
                  </Badge>
                  {finding.declaredOnly ? (
                    <Badge tone="warn" title="Reached only through an optional or dev dependency">
                      not installed
                    </Badge>
                  ) : finding.hops === 1 ? (
                    <Badge tone="danger">direct</Badge>
                  ) : (
                    <Badge tone="neutral">{finding.hops} hops</Badge>
                  )}
                </div>
                <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-ink-muted">{finding.summary}</p>
                <RouteTrail steps={finding.route} className="mt-2" />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="mt-5">
        <PanelHeader
          title="Direct dependencies"
          description="What this service asks for, and how much each one drags in behind it."
        />
        {app.directDependencies.length === 0 ? (
          <EmptyState title="No direct dependencies recorded" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.08em] text-ink-faint">
                  <th scope="col" className="px-5 py-2.5 font-medium">Package</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Range</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Scope</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Pulls in</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">Advisories</th>
                </tr>
              </thead>
              <tbody>
                {app.directDependencies.map((dep) => (
                  <tr key={dep.name} className="border-b border-line/60 last:border-0 hover:bg-surface-hover">
                    <td className="px-5 py-2.5">
                      <PackageLink name={dep.name} />
                      <span className="ml-2 text-[11px] text-ink-faint">
                        {formatCompact(dep.weeklyDownloads)}/wk
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[12px] text-ink-muted">{dep.versionRange}</td>
                    <td className="px-3 py-2.5">
                      {dep.scope === "dev" ? (
                        <Badge tone="quiet">dev</Badge>
                      ) : (
                        <Badge tone="accent">runtime</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular text-ink-muted">{dep.transitivePackages}</td>
                    <td className="px-5 py-2.5 text-right tabular">
                      {dep.advisories > 0 ? (
                        <span className="font-semibold text-critical">{dep.advisories}</span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
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
