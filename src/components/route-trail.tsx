import Link from "next/link";

import type { RouteStep } from "@/lib/queries/types";

import { cx } from "./ui/primitives";

/**
 * A dependency route rendered as a chain.
 *
 * This is the component that makes the graph legible to someone who does not
 * think in graphs. A blast-radius table that says "Checkout API is exposed"
 * invites the question "through what?", and the honest answer is a path —
 * `Checkout API → express → body-parser → qs`. Showing the path turns a
 * result into an explanation, and it is only cheap to show because the
 * traversal returned it in the first place.
 *
 * Dashed connectors mark hops that are optional or dev-only, so a reader can
 * see at a glance that a route is not necessarily installed.
 */
export function RouteTrail({
  steps,
  edgeTypes,
  className,
}: {
  steps: RouteStep[];
  /** One entry per hop. When omitted every hop renders as an installed dependency. */
  edgeTypes?: string[];
  className?: string;
}) {
  if (steps.length === 0) return null;

  return (
    <ol className={cx("flex flex-wrap items-center gap-x-1 gap-y-1.5", className)}>
      {steps.map((step, index) => {
        const edgeType = edgeTypes?.[index - 1];
        const soft = edgeType !== undefined && edgeType !== "DEPENDS_ON";

        return (
          <li key={`${step.kind}-${step.id}-${index}`} className="flex items-center gap-1">
            {index > 0 ? (
              <span
                aria-hidden="true"
                title={
                  edgeType === "DEPENDS_ON_DEV"
                    ? "dev dependency — not shipped"
                    : edgeType === "DEPENDS_ON_OPTIONAL"
                      ? "optional dependency — may not be installed"
                      : undefined
                }
                className={cx("select-none px-0.5 text-[11px]", soft ? "text-moderate" : "text-ink-faint")}
              >
                {soft ? "⇢" : "→"}
              </span>
            ) : null}

            {step.kind === "application" ? (
              <Link
                href={`/applications/${encodeURIComponent(step.id)}`}
                className="rounded border border-accent/25 bg-accent-wash px-1.5 py-0.5 text-[11px] font-medium text-accent transition-colors hover:border-accent/50"
              >
                {step.label}
              </Link>
            ) : (
              <Link
                href={`/packages/${encodeURIComponent(step.id)}`}
                className={cx(
                  "rounded border px-1.5 py-0.5 font-mono text-[11px] transition-colors",
                  index === steps.length - 1
                    ? "border-critical/30 bg-critical-wash text-critical hover:border-critical/60"
                    : "border-line-strong bg-surface-raised text-ink-muted hover:border-ink-faint hover:text-ink",
                )}
              >
                {step.label}
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}
