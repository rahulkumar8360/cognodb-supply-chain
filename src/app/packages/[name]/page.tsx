import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { GraphCanvas } from "@/components/graph-canvas";
import {
  AdvisoryLink,
  AppLink,
  Badge,
  CriticalityBadge,
  EmptyState,
  PackageLink,
  Panel,
  PanelHeader,
  PageHeader,
  SeverityBadge,
  Skeleton,
  Stat,
  formatAge,
  formatCompact,
} from "@/components/ui/primitives";
import { RetryableError } from "@/components/ui/retryable-error";
import { attempt } from "@/lib/attempt";
import { getPackageDetail, getPackageNeighbourhood } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Params = Promise<{ name: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { name } = await params;
  return { title: decodeURIComponent(name) };
}

export default async function PackagePage({ params }: { params: Params }) {
  const { name } = await params;
  const packageName = decodeURIComponent(name);
  const result = await attempt(() => getPackageDetail(packageName));

  if (!result.ok) {
    return (
      <>
        <PageHeader eyebrow="Package" title={packageName} />
        <RetryableError error={result.error} />
      </>
    );
  }

  if (!result.data) notFound();

  const pkg = result.data;
  const soloMaintained = pkg.maintainers.length === 1;
  const copyleft = pkg.licenseCategory === "strong-copyleft" || pkg.licenseCategory === "source-available";

  return (
    <>
      <PageHeader
        eyebrow="Package"
        title={pkg.name}
        description={pkg.description}
        actions={
          <>
            <Link
              href={`/trace?package=${encodeURIComponent(pkg.name)}`}
              className="rounded-lg border border-accent/30 bg-accent-wash px-3 py-1.5 text-[13px] font-medium text-accent transition-colors hover:border-accent/60"
            >
              Trace a path here
            </Link>
            <Link
              href="/packages"
              className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              All packages
            </Link>
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone="neutral">v{pkg.version}</Badge>
        <Badge tone={copyleft ? "warn" : "neutral"} title={pkg.licenseName}>
          {pkg.license}
        </Badge>
        <Badge tone="quiet">published {formatAge(pkg.lastPublished)}</Badge>
        {pkg.deprecated ? <Badge tone="warn">deprecated</Badge> : null}
        {soloMaintained ? (
          <Badge tone="warn" title="A single account can publish a new version of this package">
            bus factor 1
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Weekly downloads"
          value={formatCompact(pkg.weeklyDownloads)}
          hint="Across the whole registry"
        />
        <Stat
          label="Reached by"
          value={pkg.reachedByApplications.length}
          tone={pkg.reachedByApplications.length > 0 ? "moderate" : "neutral"}
          hint="Meridian services, at any depth"
        />
        <Stat
          label="Pulls in"
          value={pkg.transitiveDependencies}
          hint="Packages installed behind it"
        />
        <Stat
          label="Advisories"
          value={pkg.advisories.length}
          tone={pkg.advisories.length > 0 ? "critical" : "safe"}
          hint={pkg.advisories.length === 0 ? "Nothing published against it" : "Against this package"}
        />
      </div>

      {pkg.advisories.length > 0 ? (
        <Panel className="mt-6">
          <PanelHeader title="Advisories" description="Open one to see which services it reaches." />
          <ul className="divide-y divide-line/60">
            {pkg.advisories.map((advisory) => (
              <li key={advisory.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <AdvisoryLink id={advisory.id} />
                    <SeverityBadge severity={advisory.severity} />
                    <Badge tone="neutral">CVSS {advisory.cvss.toFixed(1)}</Badge>
                    {advisory.simulated ? <Badge tone="quiet">simulated</Badge> : null}
                  </div>
                  <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-ink-muted">{advisory.summary}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] text-ink-faint">fixed in</p>
                  <p className="font-mono text-[13px] font-medium text-safe">{advisory.patchedIn}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel className="mt-5">
        <PanelHeader
          title="Neighbourhood"
          description="Two hops out in each direction. Drag to pan, scroll to zoom, click a node to open it."
        />
        <Suspense fallback={<Skeleton className="m-5 h-[480px]" />}>
          <Neighbourhood name={pkg.name} />
        </Suspense>
      </Panel>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Maintainers"
            description={
              soloMaintained
                ? "One account controls what ships in this package."
                : `${pkg.maintainers.length} accounts can publish a new version.`
            }
          />
          {pkg.maintainers.length === 0 ? (
            <EmptyState title="No maintainers recorded" />
          ) : (
            <ul className="divide-y divide-line/60">
              {pkg.maintainers.map((maintainer) => (
                <li key={maintainer.username} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink">{maintainer.name}</p>
                    <p className="font-mono text-[11px] text-ink-faint">@{maintainer.username}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {maintainer.twoFactorEnabled ? (
                      <Badge tone="good">2FA</Badge>
                    ) : (
                      <Badge tone="danger" title="No two-factor authentication on this account">
                        no 2FA
                      </Badge>
                    )}
                    <Badge tone="neutral">{maintainer.role}</Badge>
                    <span className="text-[11px] tabular text-ink-faint" title="Other packages this account maintains">
                      {maintainer.packagesMaintained} pkg
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="Reached by"
            description="Services with a dependency path to this package, shortest first."
          />
          {pkg.reachedByApplications.length === 0 ? (
            <EmptyState
              title="Nothing reaches this package"
              description="It is in the graph because something else declares it, but no application installs it."
            />
          ) : (
            <ul className="scroll-panel max-h-[320px] divide-y divide-line/60 overflow-y-auto">
              {pkg.reachedByApplications.map((app) => (
                <li key={app.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <div className="flex items-center gap-2">
                    <AppLink id={app.id} name={app.name} />
                    <CriticalityBadge criticality={app.criticality} />
                  </div>
                  <Link
                    href={`/trace?app=${encodeURIComponent(app.id)}&package=${encodeURIComponent(pkg.name)}`}
                    className="text-[12px] text-ink-faint transition-colors hover:text-accent"
                  >
                    {app.hops} {app.hops === 1 ? "hop" : "hops"} →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader title={`Depends on (${pkg.dependencies.length})`} />
          {pkg.dependencies.length === 0 ? (
            <EmptyState title="No dependencies" description="This package stands on its own." />
          ) : (
            <ul className="scroll-panel max-h-[340px] divide-y divide-line/60 overflow-y-auto">
              {pkg.dependencies.map((dep) => (
                <li key={dep.name} className="flex items-center justify-between gap-3 px-5 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <PackageLink name={dep.name} />
                    <span className="font-mono text-[11px] text-ink-faint">{dep.versionRange}</span>
                    {dep.scope === "optional" ? <Badge tone="quiet">optional</Badge> : null}
                  </div>
                  {dep.advisories > 0 ? (
                    <Badge tone="danger">{dep.advisories}</Badge>
                  ) : (
                    <span className="text-[11px] text-ink-faint">{formatCompact(dep.weeklyDownloads)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title={`Depended on by (${pkg.dependents.length}${pkg.dependents.length === 60 ? "+" : ""})`}
            description={`${pkg.transitiveDependents} packages reach it transitively.`}
          />
          {pkg.dependents.length === 0 ? (
            <EmptyState title="Nothing depends on this" description="It is only reached directly from an application." />
          ) : (
            <ul className="scroll-panel max-h-[340px] divide-y divide-line/60 overflow-y-auto">
              {pkg.dependents.map((dep) => (
                <li key={dep.name} className="flex items-center justify-between gap-3 px-5 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <PackageLink name={dep.name} />
                    {dep.scope !== "runtime" ? <Badge tone="quiet">{dep.scope}</Badge> : null}
                  </div>
                  <span className="text-[11px] text-ink-faint">{formatCompact(dep.weeklyDownloads)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

async function Neighbourhood({ name }: { name: string }) {
  const result = await attempt(() => getPackageNeighbourhood(name));

  if (!result.ok) {
    return (
      <div className="p-4">
        <RetryableError error={result.error} compact />
      </div>
    );
  }

  return (
    <GraphCanvas
      nodes={result.data.nodes}
      edges={result.data.edges}
      focusId={name}
      truncated={result.data.truncated}
    />
  );
}
