"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import type { ApplicationOption } from "@/lib/queries/applications";

import { cx, formatCompact } from "./ui/primitives";

type Suggestion = { name: string; version: string; weeklyDownloads: number };

/**
 * The two-endpoint picker for the path tracer.
 *
 * The package field is a type-ahead rather than a plain text box because there
 * are a couple of thousand packages in the graph and almost nobody knows the
 * exact name of the one four levels down that they are chasing. Submitting
 * navigates rather than fetching, so the resulting view is a shareable URL and
 * the server does the query — same as every other page here.
 */
export function TraceForm({
  applications,
  initialApplicationId,
  initialPackageName,
}: {
  applications: ApplicationOption[];
  initialApplicationId: string;
  initialPackageName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [applicationId, setApplicationId] = useState(initialApplicationId || applications[0]?.id || "");
  const [packageName, setPackageName] = useState(initialPackageName);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [searchFailed, setSearchFailed] = useState(false);

  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  // Close the suggestion list on an outside click, the way a native combobox does.
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => () => clearTimeout(debounce.current), []);

  function onPackageChange(value: string) {
    setPackageName(value);
    setHighlight(0);
    clearTimeout(debounce.current);

    if (value.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    debounce.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/packages/search?q=${encodeURIComponent(value.trim())}`);
        const body = await response.json();
        setSuggestions(body.results ?? []);
        setSearchFailed(Boolean(body.error));
        setOpen(true);
      } catch {
        setSuggestions([]);
        setSearchFailed(true);
      }
    }, 220);
  }

  function submit(name = packageName) {
    if (!applicationId || !name.trim()) return;
    setOpen(false);
    startTransition(() => {
      router.push(`/trace?app=${encodeURIComponent(applicationId)}&package=${encodeURIComponent(name.trim())}`);
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <label className="flex min-w-[200px] flex-1 flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">Service</span>
        <select
          value={applicationId}
          onChange={(event) => setApplicationId(event.target.value)}
          className="rounded-lg border border-line bg-surface px-2.5 py-2 text-[13px] text-ink focus:border-accent/50 focus:outline-none"
        >
          {applications.map((application) => (
            <option key={application.id} value={application.id}>
              {application.name}
            </option>
          ))}
        </select>
      </label>

      <div ref={containerRef} className="relative flex min-w-[220px] flex-1 flex-col gap-1.5">
        <label htmlFor={listId} className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          Package
        </label>
        <input
          id={listId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          autoComplete="off"
          value={packageName}
          placeholder="Start typing — e.g. qs"
          onChange={(event) => onPackageChange(event.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onKeyDown={(event) => {
            if (!open || suggestions.length === 0) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlight((index) => (index + 1) % suggestions.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((index) => (index - 1 + suggestions.length) % suggestions.length);
            } else if (event.key === "Enter") {
              event.preventDefault();
              const chosen = suggestions[highlight];
              if (chosen) {
                setPackageName(chosen.name);
                submit(chosen.name);
              }
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          className="rounded-lg border border-line bg-surface px-2.5 py-2 font-mono text-[13px] text-ink placeholder:font-sans placeholder:text-ink-faint focus:border-accent/50 focus:outline-none"
        />

        {open && suggestions.length > 0 ? (
          <ul
            id={`${listId}-list`}
            role="listbox"
            className="scroll-panel absolute top-full z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-surface-raised py-1 shadow-xl"
          >
            {suggestions.map((suggestion, index) => (
              <li key={suggestion.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlight}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => {
                    setPackageName(suggestion.name);
                    submit(suggestion.name);
                  }}
                  className={cx(
                    "flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left",
                    index === highlight ? "bg-surface-hover" : "",
                  )}
                >
                  <span className="truncate font-mono text-[12px] text-ink">{suggestion.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-faint">
                    {formatCompact(suggestion.weeklyDownloads)}/wk
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {searchFailed ? (
          <p className="absolute top-full mt-1 text-[11px] text-moderate">
            Suggestions are unavailable — type the exact package name and press Trace.
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={isPending || !applicationId || packageName.trim() === ""}
        className="rounded-lg border border-accent/40 bg-accent-wash px-4 py-2 text-[13px] font-medium text-accent transition-colors enabled:hover:border-accent/70 disabled:opacity-50"
      >
        {isPending ? "Tracing…" : "Trace"}
      </button>
    </form>
  );
}
