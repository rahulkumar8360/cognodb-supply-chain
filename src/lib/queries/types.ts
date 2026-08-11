export type Severity = "critical" | "high" | "moderate" | "low";

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "moderate", "low"];

export type SeverityCounts = Record<Severity, number>;

export type LicenseCategory = "permissive" | "weak-copyleft" | "strong-copyleft" | "source-available";

export type Criticality = "tier-1" | "tier-2" | "tier-3";

/** A node as it appears on a rendered dependency route. */
export type RouteStep = {
  kind: "application" | "package";
  /** Stable key for linking: an Application id or a Package name. */
  id: string;
  label: string;
};

export type ApplicationSummary = {
  id: string;
  name: string;
  team: string;
  criticality: Criticality;
  environment: "production" | "internal";
  description: string;
};

export type PackageSummary = {
  name: string;
  version: string;
  description: string;
  weeklyDownloads: number;
  license: string;
  deprecated: boolean;
};

export type AdvisorySummary = {
  id: string;
  severity: Severity;
  cvss: number;
  cwe: string;
  summary: string;
  publishedAt: string;
  simulated: boolean;
};

/**
 * How a package is reached from an application.
 *
 * `installed`   — there is a path made entirely of runtime dependencies, so the
 *                 code is on disk in production.
 * `declared`    — the only routes run through an optional or dev dependency, so
 *                 the package may never be installed in the shipped artifact.
 */
export type ExposureKind = "installed" | "declared";
