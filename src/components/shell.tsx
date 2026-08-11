"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { cx } from "./ui/primitives";

type NavItem = { href: string; label: string; hint: string };

const NAV: NavItem[] = [
  { href: "/", label: "Overview", hint: "Where the exposure is right now" },
  { href: "/applications", label: "Applications", hint: "What each service pulls in" },
  { href: "/advisories", label: "Advisories", hint: "The feed, filtered to what we run" },
  { href: "/packages", label: "Packages", hint: "Every package in the tree" },
  { href: "/maintainers", label: "Maintainer risk", hint: "Who can push code into production" },
  { href: "/licenses", label: "Licence exposure", hint: "Copyleft on a shipping path" },
  { href: "/phantom", label: "Phantom deps", hint: "Declared but never installed" },
  { href: "/trace", label: "Trace a path", hint: "Why is this package in my build?" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile drawer whenever the route changes, so a tap on a link
  // doesn't leave the overlay covering the page it just navigated to.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-dvh lg:flex">
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/" className="flex items-center gap-2.5">
          <Mark />
          <span className="text-sm font-semibold tracking-tight">Supply Chain Atlas</span>
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          className="rounded-lg border border-line p-1.5 text-ink-muted"
        >
          <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            {menuOpen ? (
              <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>

      <aside
        id="primary-navigation"
        className={cx(
          "border-line bg-surface/40 lg:sticky lg:top-0 lg:h-dvh lg:w-64 lg:shrink-0 lg:border-r",
          menuOpen ? "block border-b" : "hidden lg:block",
        )}
      >
        <div className="flex h-full flex-col">
          <Link href="/" className="hidden items-center gap-2.5 px-5 py-5 lg:flex">
            <Mark />
            <div className="leading-tight">
              <p className="text-[13px] font-semibold tracking-tight text-ink">Supply Chain Atlas</p>
              <p className="text-[11px] text-ink-faint">Meridian Logistics</p>
            </div>
          </Link>

          <nav className="flex-1 space-y-0.5 px-3 py-3 lg:py-0" aria-label="Primary">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "group block rounded-lg px-3 py-2 transition-colors",
                    active ? "bg-surface-raised text-ink" : "text-ink-muted hover:bg-surface hover:text-ink",
                  )}
                >
                  <span className="flex items-center gap-2 text-[13px] font-medium">
                    {active ? (
                      <span aria-hidden="true" className="h-3.5 w-0.5 rounded-full bg-accent" />
                    ) : (
                      <span aria-hidden="true" className="h-3.5 w-0.5 rounded-full bg-transparent" />
                    )}
                    {item.label}
                  </span>
                  <span className="mt-0.5 block pl-2.5 text-[11px] leading-snug text-ink-faint">{item.hint}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-line px-5 py-4">
            <ConnectionStatus />
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1180px] px-5 py-7 lg:px-8 lg:py-10">{children}</div>
      </main>
    </div>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 28 28" className="h-7 w-7 shrink-0" aria-hidden="true">
      <circle cx="14" cy="5.5" r="3" fill="var(--color-accent)" />
      <circle cx="6" cy="19" r="2.6" fill="var(--color-ink-muted)" />
      <circle cx="22" cy="19" r="2.6" fill="var(--color-critical)" />
      <path
        d="M14 8.5 6.8 16.6M14 8.5l7.2 8.1M8.4 19.6h11.2"
        stroke="var(--color-line-strong)"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

type Health =
  | { state: "checking" }
  | { state: "up"; latencyMs: number }
  | { state: "down"; message: string };

/**
 * Live connection indicator.
 *
 * It exists because the single most likely thing to go wrong with a free-tier
 * demo is the instance going to sleep, and "is it me or is it the database?"
 * should be answerable at a glance rather than by reading an error on whichever
 * page happened to fail first.
 */
function ConnectionStatus() {
  const [health, setHealth] = useState<Health>({ state: "checking" });

  useEffect(() => {
    let cancelled = false;

    async function probe() {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const body = await response.json();
        if (cancelled) return;
        setHealth(
          body.ok
            ? { state: "up", latencyMs: body.latencyMs }
            : { state: "down", message: body.error?.message ?? "Unreachable" },
        );
      } catch {
        if (!cancelled) setHealth({ state: "down", message: "Unreachable" });
      }
    }

    probe();
    const timer = setInterval(probe, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const dot =
    health.state === "up" ? "bg-safe" : health.state === "down" ? "bg-critical" : "bg-ink-faint animate-pulse";

  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className={cx("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
      <div className="min-w-0 leading-tight">
        <p className="text-[11px] font-medium text-ink-muted">
          {health.state === "up" ? "CognoDB connected" : health.state === "down" ? "CognoDB unreachable" : "Checking…"}
        </p>
        <p className="truncate text-[10px] text-ink-faint">
          {health.state === "up"
            ? `${health.latencyMs} ms round trip`
            : health.state === "down"
              ? health.message
              : "Probing the instance"}
        </p>
      </div>
    </div>
  );
}
