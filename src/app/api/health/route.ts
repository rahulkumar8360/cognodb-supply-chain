import { NextResponse } from "next/server";

import { serializeDatabaseError } from "@/lib/errors";
import { checkHealth } from "@/lib/neo4j";

export const dynamic = "force-dynamic";

/**
 * Connection probe for the status indicator in the header.
 *
 * Deliberately separate from the page queries: it uses the driver's own
 * `getServerInfo` handshake rather than running Cypher, so it reports on the
 * connection itself and stays fast even when the instance is busy.
 */
export async function GET() {
  const health = await checkHealth();

  if (health.ok) {
    return NextResponse.json(
      { ok: true, latencyMs: health.latencyMs, address: health.address },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return NextResponse.json(
    { ok: false, error: serializeDatabaseError(health.error) },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}
