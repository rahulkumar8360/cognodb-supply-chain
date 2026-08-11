"use client";

import { useState, useTransition } from "react";

import type { SerializedDatabaseError } from "@/lib/errors";

import { cx } from "./primitives";

/**
 * What the user sees when the database will not answer.
 *
 * The three failure modes a reviewer will actually hit are different problems
 * with different fixes, so they get different screens rather than one "Error"
 * box: a free-tier instance that has gone to sleep needs a retry, missing
 * environment variables need a setup checklist, and a rejected password needs
 * to be rotated in the console. Guessing which one it is from a stack trace is
 * the reader's job in a worse version of this app.
 */

type Props = {
  error: SerializedDatabaseError;
  onRetry?: () => void;
  /** Renders inline inside a panel rather than as a full-page state. */
  compact?: boolean;
};

const COPY: Record<
  SerializedDatabaseError["kind"],
  { title: string; body: string; steps?: string[] }
> = {
  unreachable: {
    title: "Can't reach the database",
    body: "The app is running, but the CognoDB instance did not answer in time.",
    steps: [
      "Free-tier (c0) instances are paused when idle — open the CognoDB console and check the instance is running.",
      "Confirm COGNODB_URI matches the instance's Bolt endpoint exactly, including the bolt+s:// scheme.",
      "If the instance was only just created, give it a minute to finish provisioning.",
    ],
  },
  unconfigured: {
    title: "The database isn't configured yet",
    body: "No connection details were found in the environment.",
    steps: [
      "Copy .env.example to .env.local.",
      "Fill in COGNODB_URI and COGNODB_PASSWORD from console.cognodb.com.",
      "Run npm run seed to load the demo dataset, then restart the dev server.",
    ],
  },
  unauthorized: {
    title: "The database rejected these credentials",
    body: "The connection reached CognoDB, but the username or password was not accepted.",
    steps: [
      "The username for a CognoDB instance is cognodb unless you changed it.",
      "The generated password is shown only once, at instance creation. If it was lost, rotate it from the console.",
    ],
  },
  timeout: {
    title: "That query took too long",
    body: "The traversal was cancelled before it finished.",
    steps: [
      "Free instances share a burstable 0.5 vCPU, so a deep traversal can exceed the deadline under load.",
      "Try again, or narrow the query with a filter.",
    ],
  },
  query: {
    title: "The database rejected this query",
    body: "This is a bug in the application rather than something you can fix from here.",
  },
  unknown: {
    title: "Something went wrong",
    body: "The request to the database failed for an unexpected reason.",
  },
};

export function DatabaseErrorState({ error, onRetry, compact = false }: Props) {
  const [isPending, startTransition] = useTransition();
  const [showDetail, setShowDetail] = useState(false);
  const copy = COPY[error.kind] ?? COPY.unknown;

  return (
    <div
      role="alert"
      className={cx(
        "rounded-xl border border-critical/25 bg-critical-wash/40",
        compact ? "px-4 py-4" : "px-6 py-8",
      )}
    >
      <div className="flex items-start gap-3">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-critical)"
          strokeWidth="1.6"
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0"
        >
          <path d="M12 8.5v4.5" strokeLinecap="round" />
          <circle cx="12" cy="16.2" r="0.9" fill="var(--color-critical)" stroke="none" />
          <path d="M10.3 3.9 2.6 17.4A1.9 1.9 0 0 0 4.3 20.3h15.4a1.9 1.9 0 0 0 1.7-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z" />
        </svg>

        <div className="min-w-0 flex-1">
          <h2 className={cx("font-semibold text-ink", compact ? "text-sm" : "text-base")}>{copy.title}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{copy.body}</p>

          {/* The troubleshooting steps are the same on every panel, and when a
              whole page fails, three copies of the same checklist is noise.
              Compact panels show the headline and a retry; the full-size state
              — one per page — carries the instructions. */}
          {copy.steps && !compact ? (
            <ul className="mt-3 space-y-1.5">
              {copy.steps.map((step) => (
                <li key={step} className="flex gap-2 text-[13px] leading-relaxed text-ink-muted">
                  <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {error.retryable && onRetry ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => startTransition(() => onRetry())}
                className="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-surface-raised px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-surface-hover disabled:opacity-60"
              >
                {isPending ? (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 animate-spin" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.25" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                  </svg>
                ) : null}
                {isPending ? "Retrying…" : "Try again"}
              </button>
            ) : null}

            {error.detail ? (
              <button
                type="button"
                onClick={() => setShowDetail((value) => !value)}
                className="rounded-lg px-2 py-1.5 text-[13px] text-ink-faint transition-colors hover:text-ink-muted"
              >
                {showDetail ? "Hide details" : "Show details"}
              </button>
            ) : null}
          </div>

          {showDetail && error.detail ? (
            <pre className="scroll-panel mt-3 max-h-40 overflow-auto rounded-lg border border-line bg-canvas px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink-muted">
              {error.detail}
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}
