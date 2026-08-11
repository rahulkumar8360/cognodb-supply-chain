import {
  AppLink,
  Badge,
  CriticalityBadge,
  EmptyState,
  Panel,
  PageHeader,
} from "@/components/ui/primitives";
import { RetryableError } from "@/components/ui/retryable-error";
import { attempt } from "@/lib/attempt";
import { getApplicationExposure } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Applications" };

export default async function ApplicationsPage() {
  const result = await attempt(getApplicationExposure);

  return (
    <>
      <PageHeader
        eyebrow="Applications"
        title="Everything Meridian runs"
        description="Each service, what it installs, and what is reachable from it. The package counts are transitive closures computed on request, not stored totals — which is why they are always right."
      />

      {!result.ok ? (
        <RetryableError error={result.error} />
      ) : result.data.length === 0 ? (
        <Panel>
          <EmptyState title="No applications yet" description="Run npm run seed to load the demo dataset." />
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {result.data.map((app) => {
            const total = app.critical + app.high + app.moderate + app.low;
            return (
              <article
                key={app.id}
                className="flex flex-col rounded-xl border border-line bg-surface p-4 transition-colors hover:border-line-strong"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <AppLink id={app.id} name={app.name} className="text-[15px]" />
                    <p className="mt-0.5 text-[11px] text-ink-faint">
                      {app.team} · {app.environment}
                    </p>
                  </div>
                  <CriticalityBadge criticality={app.criticality} />
                </div>

                <p className="mt-2.5 flex-1 text-[12px] leading-relaxed text-ink-muted">{app.description}</p>

                <dl className="mt-3.5 grid grid-cols-2 gap-2 border-t border-line pt-3 text-[12px]">
                  <div>
                    <dt className="text-[11px] text-ink-faint">Packages installed</dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular text-ink">{app.installedPackages}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-ink-faint">Advisories reachable</dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular text-ink">{total}</dd>
                  </div>
                </dl>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {app.critical > 0 ? <Badge tone="danger">{app.critical} critical</Badge> : null}
                  {app.high > 0 ? <Badge tone="warn">{app.high} high</Badge> : null}
                  {total === 0 ? <Badge tone="good">nothing reachable</Badge> : null}
                  {app.declaredOnlyPackages > 0 ? (
                    <Badge tone="quiet" title="Declared in the tree but not installed at runtime">
                      +{app.declaredOnlyPackages} not installed
                    </Badge>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
