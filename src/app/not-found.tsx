import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-[13px] text-ink-faint">404</p>
      <h1 className="mt-2 text-lg font-semibold text-ink">Not in the graph</h1>
      <p className="mt-2 max-w-md text-[13px] leading-relaxed text-ink-muted">
        There is no node here with that name. This graph only holds packages that at least one Meridian
        service actually pulls in, so a real npm package can legitimately be missing — it just is not
        something we install.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/packages"
          className="rounded-lg border border-line-strong bg-surface-raised px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-surface-hover"
        >
          Browse packages
        </Link>
        <Link
          href="/"
          className="rounded-lg border border-line px-4 py-2 text-[13px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
        >
          Back to overview
        </Link>
      </div>
    </div>
  );
}
