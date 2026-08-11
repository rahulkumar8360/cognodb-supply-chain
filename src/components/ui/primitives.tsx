import Link from "next/link";
import type { ReactNode } from "react";

import type { Severity } from "@/lib/queries/types";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ------------------------------------------------------------------ panels --

export function Panel({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag className={cx("rounded-xl border border-line bg-surface", className)}>{children}</Tag>
  );
}

export function PanelHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
        {description ? <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// ------------------------------------------------------------------ badges --

const SEVERITY_CLASSES: Record<Severity, string> = {
  critical: "bg-critical-wash text-critical border-critical/30",
  high: "bg-high-wash text-high border-high/30",
  moderate: "bg-moderate-wash text-moderate border-moderate/30",
  low: "bg-low-wash text-low border-low/30",
};

export function SeverityBadge({ severity, className }: { severity: Severity | null; className?: string }) {
  if (!severity) {
    return (
      <span
        className={cx(
          "inline-flex items-center rounded-md border border-safe/30 bg-safe-wash px-1.5 py-0.5 text-[11px] font-medium text-safe",
          className,
        )}
      >
        clear
      </span>
    );
  }
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium capitalize",
        SEVERITY_CLASSES[severity],
        className,
      )}
    >
      {severity}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warn" | "danger" | "good" | "quiet";
  className?: string;
  title?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-line-strong bg-surface-raised text-ink-muted",
    quiet: "border-transparent bg-transparent text-ink-faint",
    accent: "border-accent/30 bg-accent-wash text-accent",
    warn: "border-moderate/30 bg-moderate-wash text-moderate",
    danger: "border-critical/30 bg-critical-wash text-critical",
    good: "border-safe/30 bg-safe-wash text-safe",
  };
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Tier-1 services are the ones that lose money when they break; they read louder. */
export function CriticalityBadge({ criticality }: { criticality: string }) {
  const tone = criticality === "tier-1" ? "danger" : criticality === "tier-2" ? "warn" : "neutral";
  return (
    <Badge tone={tone} title={criticality === "tier-1" ? "Revenue-critical service" : undefined}>
      {criticality}
    </Badge>
  );
}

// ------------------------------------------------------------------ layout --

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        {eyebrow ? (
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">{eyebrow}</p>
        ) : null}
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-2 text-sm leading-relaxed text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "critical" | "high" | "moderate" | "safe";
  href?: string;
}) {
  const valueTone: Record<string, string> = {
    neutral: "text-ink",
    critical: "text-critical",
    high: "text-high",
    moderate: "text-moderate",
    safe: "text-safe",
  };

  const body = (
    <>
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-faint">{label}</p>
      <p className={cx("mt-1.5 text-3xl font-semibold tabular tracking-tight", valueTone[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-xs leading-relaxed text-ink-muted">{hint}</p> : null}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-xl border border-line bg-surface px-4 py-3.5 transition-colors hover:border-line-strong hover:bg-surface-hover"
      >
        {body}
      </Link>
    );
  }

  return <div className="rounded-xl border border-line bg-surface px-4 py-3.5">{body}</div>;
}

// ------------------------------------------------------------------ states --

export function EmptyState({
  title,
  description,
  action,
  icon = "empty",
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: "empty" | "search" | "good";
}) {
  const glyph = {
    empty: (
      <path d="M4 7h16M4 12h10M4 17h6" strokeLinecap="round" />
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="6" />
        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </>
    ),
    good: <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />,
  }[icon];

  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke={icon === "good" ? "var(--color-safe)" : "var(--color-ink-faint)"}
        strokeWidth="1.5"
        aria-hidden="true"
        className="mb-3 h-9 w-9"
      >
        {glyph}
      </svg>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton rounded-md", className)} aria-hidden="true" />;
}

export function TableSkeleton({ rows = 8, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="px-5 py-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading results</span>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="flex items-center gap-4">
            {Array.from({ length: columns }).map((_, columnIndex) => (
              <Skeleton
                key={columnIndex}
                className={cx("h-4", columnIndex === 0 ? "w-1/3" : "flex-1")}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-2.5 h-8 w-16" />
      <Skeleton className="mt-2 h-3 w-28" />
    </div>
  );
}

// ------------------------------------------------------------------- links --

export function PackageLink({ name, className }: { name: string; className?: string }) {
  return (
    <Link
      href={`/packages/${encodeURIComponent(name)}`}
      className={cx("font-mono text-[13px] text-ink transition-colors hover:text-accent", className)}
    >
      {name}
    </Link>
  );
}

export function AppLink({ id, name, className }: { id: string; name: string; className?: string }) {
  return (
    <Link
      href={`/applications/${encodeURIComponent(id)}`}
      className={cx("font-medium text-ink transition-colors hover:text-accent", className)}
    >
      {name}
    </Link>
  );
}

export function AdvisoryLink({ id, className }: { id: string; className?: string }) {
  return (
    <Link
      href={`/advisories/${encodeURIComponent(id)}`}
      className={cx("font-mono text-[13px] text-ink transition-colors hover:text-accent", className)}
    >
      {id}
    </Link>
  );
}

// ------------------------------------------------------------ number format --

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat("en");

export function formatCompact(value: number): string {
  return compact.format(value);
}

export function formatNumber(value: number): string {
  return plain.format(value);
}

/** "3 days ago" style, from an ISO date. Kept deterministic against the dataset's anchor date. */
export function formatAge(isoDate: string): string {
  const then = new Date(`${isoDate}T00:00:00Z`).getTime();
  const days = Math.round((Date.now() - then) / 86_400_000);
  if (!Number.isFinite(days)) return isoDate;
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  const years = (days / 365).toFixed(days < 730 ? 1 : 0);
  return `${years}y ago`;
}
