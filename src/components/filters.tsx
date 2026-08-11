"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { cx } from "./ui/primitives";

/**
 * Filters live in the URL rather than in component state.
 *
 * That is not a stylistic preference: it means a filtered view is a link. When
 * the security team finds the four services exposed to a critical advisory,
 * they can paste that exact view into an incident channel, and it survives a
 * refresh, the back button and a cold browser. Component state does none of
 * that.
 *
 * `useTransition` keeps the previous results on screen while the server
 * re-queries, so typing in the search box doesn't flash the table away on every
 * keystroke.
 */
function useQueryParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      // Any filter change invalidates the current page of results.
      if (!("page" in updates)) next.delete("page");
      const query = next.toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  return { searchParams, setParams, isPending };
}

export function SearchInput({
  placeholder,
  paramName = "q",
  className,
}: {
  placeholder: string;
  paramName?: string;
  className?: string;
}) {
  const { searchParams, setParams, isPending } = useQueryParams();
  const initial = searchParams.get(paramName) ?? "";
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Keep the box in step when the URL changes from somewhere else — a nav
  // click, the back button — without fighting the user mid-keystroke.
  useEffect(() => {
    setValue(initial);
  }, [initial]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className={cx("relative", className)}>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="11" cy="11" r="6.5" />
        <path d="m20 20-3.8-3.8" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          // Debounced so a five-letter package name is one query, not five.
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setParams({ [paramName]: next }), 280);
        }}
        className="w-full rounded-lg border border-line bg-surface py-1.5 pl-8 pr-8 text-[13px] text-ink placeholder:text-ink-faint focus:border-accent/50 focus:outline-none"
      />
      {isPending ? (
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-ink-faint"
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.25" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </svg>
      ) : null}
    </div>
  );
}

export type ChoiceOption = { value: string; label: string; tone?: "critical" | "high" | "moderate" | "low" };

export function ChoiceGroup({
  paramName,
  options,
  label,
  allLabel = "All",
}: {
  paramName: string;
  options: ChoiceOption[];
  label: string;
  allLabel?: string;
}) {
  const { searchParams, setParams } = useQueryParams();
  const current = searchParams.get(paramName);

  const toneClasses: Record<string, string> = {
    critical: "border-critical/40 bg-critical-wash text-critical",
    high: "border-high/40 bg-high-wash text-high",
    moderate: "border-moderate/40 bg-moderate-wash text-moderate",
    low: "border-low/40 bg-low-wash text-low",
  };

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <button
        type="button"
        onClick={() => setParams({ [paramName]: null })}
        aria-pressed={current === null}
        className={cx(
          "rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors",
          current === null
            ? "border-line-strong bg-surface-raised text-ink"
            : "border-transparent text-ink-faint hover:text-ink-muted",
        )}
      >
        {allLabel}
      </button>
      {options.map((option) => {
        const active = current === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setParams({ [paramName]: active ? null : option.value })}
            aria-pressed={active}
            className={cx(
              "rounded-lg border px-2.5 py-1 text-[12px] font-medium capitalize transition-colors",
              active
                ? (option.tone && toneClasses[option.tone]) || "border-line-strong bg-surface-raised text-ink"
                : "border-transparent text-ink-faint hover:text-ink-muted",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function ToggleFilter({ paramName, label, title }: { paramName: string; label: string; title?: string }) {
  const { searchParams, setParams } = useQueryParams();
  const active = searchParams.get(paramName) === "1";

  return (
    <button
      type="button"
      title={title}
      onClick={() => setParams({ [paramName]: active ? null : "1" })}
      aria-pressed={active}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors",
        active
          ? "border-accent/40 bg-accent-wash text-accent"
          : "border-line text-ink-faint hover:border-line-strong hover:text-ink-muted",
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "flex h-3 w-3 items-center justify-center rounded-[3px] border",
          active ? "border-accent bg-accent" : "border-line-strong",
        )}
      >
        {active ? (
          <svg viewBox="0 0 10 10" className="h-2 w-2" aria-hidden="true">
            <path d="m1.5 5 2.2 2.2L8.5 2.5" stroke="var(--color-canvas)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
      {label}
    </button>
  );
}

export function SelectFilter({
  paramName,
  label,
  options,
  placeholder,
}: {
  paramName: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
}) {
  const { searchParams, setParams } = useQueryParams();
  const current = searchParams.get(paramName) ?? "";

  return (
    <label className="flex items-center gap-2 text-[12px] text-ink-faint">
      <span className="sr-only">{label}</span>
      <select
        value={current}
        onChange={(event) => setParams({ [paramName]: event.target.value || null })}
        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-[12px] text-ink focus:border-accent/50 focus:outline-none"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Pagination({ total, pageSize, page }: { total: number; pageSize: number; page: number }) {
  const { setParams, isPending } = useQueryParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
      <p className="text-[12px] tabular text-ink-faint">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={page <= 1 || isPending}
          onClick={() => setParams({ page: String(page - 1) })}
          className="rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-muted transition-colors enabled:hover:border-line-strong enabled:hover:text-ink disabled:opacity-40"
        >
          Previous
        </button>
        <span className="px-1 text-[12px] tabular text-ink-faint">
          {page} / {pages}
        </span>
        <button
          type="button"
          disabled={page >= pages || isPending}
          onClick={() => setParams({ page: String(page + 1) })}
          className="rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-muted transition-colors enabled:hover:border-line-strong enabled:hover:text-ink disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
