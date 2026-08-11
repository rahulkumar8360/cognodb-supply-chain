"use client";

import { useRouter } from "next/navigation";

import type { SerializedDatabaseError } from "@/lib/errors";

import { DatabaseErrorState } from "./database-error";

/**
 * Bridges the server-rendered failure to a client retry.
 *
 * `router.refresh()` re-runs the server components for the current route
 * without a full page load, so a retry after a sleeping instance wakes up
 * repaints just the panels that failed and keeps whatever the user had already
 * scrolled to or filtered.
 */
export function RetryableError({
  error,
  compact,
}: {
  error: SerializedDatabaseError;
  compact?: boolean;
}) {
  const router = useRouter();
  return <DatabaseErrorState error={error} compact={compact} onRetry={() => router.refresh()} />;
}
