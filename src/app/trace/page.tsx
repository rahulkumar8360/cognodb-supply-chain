import { Suspense } from "react";

import { RouteTrail } from "@/components/route-trail";
import { TraceForm } from "@/components/trace-form";
import {
  Badge,
  EmptyState,
  Panel,
  PanelHeader,
  PageHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { RetryableError } from "@/components/ui/retryable-error";
import { attempt } from "@/lib/attempt";
import { findRoutes, listApplicationOptions } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trace a path" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TracePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const applicationId = typeof params.app === "string" ? params.app : "";
  const packageName = typeof params.package === "string" ? params.package : "";

  const applications = await attempt(listApplicationOptions);

  return (
    <>
      <PageHeader
        eyebrow="Trace a path"
        title="Why is this package in my build?"
        description={
          <>
            Pick a service and a package and this returns <em>every</em> shortest route between them, not
            just one. That matters when the honest answer is “three different direct dependencies all pull
            it in, and removing one changes nothing”.
          </>
        }
      />

      <Panel>
        <PanelHeader title="Endpoints" />
        <div className="px-5 py-4">
          {applications.ok ? (
            <TraceForm
              applications={applications.data}
              initialApplicationId={applicationId}
              initialPackageName={packageName}
            />
          ) : (
            <RetryableError error={applications.error} compact />
          )}
        </div>
      </Panel>

      {applicationId && packageName ? (
        <Suspense key={`${applicationId}-${packageName}`} fallback={<RoutesSkeleton />}>
          <Routes applicationId={applicationId} packageName={packageName} />
        </Suspense>
      ) : (
        <Panel className="mt-5">
          <EmptyState
            icon="search"
            title="Choose a service and a package"
            description="Both endpoints are needed before there is a path to find. Try Checkout API and qs, or open any package page and use “Trace a path here”."
          />
        </Panel>
      )}
    </>
  );
}

async function Routes({ applicationId, packageName }: { applicationId: string; packageName: string }) {
  const result = await attempt(() => findRoutes(applicationId, packageName, 12));

  if (!result.ok) {
    return (
      <div className="mt-5">
        <RetryableError error={result.error} />
      </div>
    );
  }

  if (!result.data) {
    return (
      <Panel className="mt-5">
        <EmptyState
          title="One of those does not exist"
          description="Either the service or the package is not in the graph. Check the spelling — package names are case-sensitive."
        />
      </Panel>
    );
  }

  const { application, package: pkg, routes, shortestHops } = result.data;
  const installedRoutes = routes.filter((route) => route.installed);

  return (
    <Panel className="mt-5">
      <PanelHeader
        title={`${application.name} → ${pkg.name}`}
        description={
          shortestHops === null
            ? "No dependency path within six hops."
            : `${routes.length} shortest ${routes.length === 1 ? "route" : "routes"} of ${shortestHops} ${shortestHops === 1 ? "hop" : "hops"}. ${
                installedRoutes.length === 0
                  ? "None of them are fully installed."
                  : `${installedRoutes.length} made entirely of runtime dependencies.`
              }`
        }
      />

      {routes.length === 0 ? (
        <EmptyState
          icon="good"
          title="Not connected"
          description={`${application.name} has no dependency path to ${pkg.name} within six hops — it does not ship this package, directly or otherwise.`}
        />
      ) : (
        <ul className="divide-y divide-line/60">
          {routes.map((route, index) => (
            <li key={index} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <Badge tone={route.installed ? "accent" : "warn"}>
                {route.installed ? "installed" : "not installed"}
              </Badge>
              <RouteTrail steps={route.steps} edgeTypes={route.edgeTypes} className="flex-1" />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RoutesSkeleton() {
  return (
    <Panel className="mt-5">
      <PanelHeader title="Finding routes…" />
      <div className="space-y-3 px-5 py-4">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-6 w-full" />
        ))}
      </div>
    </Panel>
  );
}
