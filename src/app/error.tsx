"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary.
 *
 * Database failures are handled much closer to where they happen — each panel
 * catches its own and renders a state with a retry — so anything that reaches
 * here is a genuine bug rather than a sleeping instance. It says so, instead of
 * offering troubleshooting steps that would not help.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[unhandled]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <svg viewBox="0 0 24 24" className="mb-4 h-10 w-10" fill="none" stroke="var(--color-critical)" strokeWidth="1.5">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5" strokeLinecap="round" />
        <circle cx="12" cy="16" r="0.9" fill="var(--color-critical)" stroke="none" />
      </svg>
      <h1 className="text-lg font-semibold text-ink">Something broke on this page</h1>
      <p className="mt-2 max-w-md text-[13px] leading-relaxed text-ink-muted">
        This is a bug in the application rather than a problem with the database — the connection
        indicator in the sidebar will tell you if CognoDB is also unhappy.
      </p>
      {error.digest ? (
        <p className="mt-3 font-mono text-[11px] text-ink-faint">error id: {error.digest}</p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-5 rounded-lg border border-line-strong bg-surface-raised px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-surface-hover"
      >
        Try again
      </button>
    </div>
  );
}
