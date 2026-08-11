import "server-only";

import neo4j, { Driver, RecordShape, routing } from "neo4j-driver";

import { readDatabaseConfig } from "./env";
import { DatabaseError, toDatabaseError } from "./errors";

/**
 * The Bolt driver.
 *
 * CognoDB speaks openCypher over Bolt, so the official Neo4j driver connects to
 * it unchanged — the only difference from a self-hosted Neo4j is the
 * `bolt+s://` scheme, which turns on TLS with certificate verification.
 *
 * The driver owns a connection pool and is designed to be created once per
 * process. It is cached on `globalThis` so Next.js's dev-server hot reload does
 * not leak a new pool (and a new set of sockets against the free tier's
 * 200-connection cap) on every edit.
 */

declare global {
  var __cognodbDriver: Driver | undefined;
}

/** Guard rail so a pathological traversal can't hold a free-tier connection open forever. */
const QUERY_TIMEOUT_MS = 20_000;

function createDriver(): Driver {
  const config = readDatabaseConfig();

  return neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password), {
    // Counts and other 64-bit integers arrive as JS numbers rather than the
    // driver's Integer objects. Every integer this app reads is a count, a
    // depth or a CVSS score — all far below Number.MAX_SAFE_INTEGER — and plain
    // numbers cross the server/client component boundary without a custom
    // serializer.
    disableLosslessIntegers: true,
    // Fail fast when the instance is asleep or the host is wrong, so the UI can
    // show its "unreachable" state instead of hanging.
    connectionAcquisitionTimeout: 15_000,
    connectionTimeout: 10_000,
    maxConnectionPoolSize: 20,
    maxTransactionRetryTime: 8_000,
    userAgent: "cognodb-supply-chain/1.0",
  });
}

export function getDriver(): Driver {
  if (!global.__cognodbDriver) {
    global.__cognodbDriver = createDriver();
  }
  return global.__cognodbDriver;
}

export function getDatabaseName(): string {
  return readDatabaseConfig().database;
}

/**
 * Converts whole numbers in the parameter map into Bolt integers.
 *
 * `disableLosslessIntegers` is on so that counts come back as plain JS numbers,
 * but that setting is about *reading*. On the way out, a JS number is encoded
 * as a Bolt float — and `SKIP`/`LIMIT` reject a float outright
 * ("'25.0' is not a valid value. Must be a non-negative integer"). Every
 * paginated query in the app would fail without this.
 *
 * Only whole numbers are converted. A CVSS score of 7.5 is genuinely a float
 * and stays one.
 */
function toBoltParameters(params: Record<string, unknown>): Record<string, unknown> {
  const convert = (value: unknown): unknown => {
    if (typeof value === "number") {
      return Number.isInteger(value) ? neo4j.int(value) : value;
    }
    if (Array.isArray(value)) return value.map(convert);
    return value;
  };

  const converted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) converted[key] = convert(value);
  return converted;
}

export type QueryOptions = {
  /** READ routes to a follower where the topology has one; WRITE always hits the leader. */
  write?: boolean;
  timeoutMs?: number;
};

/**
 * Runs a parameterised Cypher query and returns plain objects.
 *
 * Every call site passes Cypher as a static string with `$name` placeholders
 * and supplies values through `params`. Nothing in this codebase interpolates a
 * user-supplied value into a query string: parameters are sent separately in
 * the Bolt message, which rules out Cypher injection and lets the server reuse
 * its execution plan across calls.
 */
export async function runQuery<T extends RecordShape>(
  cypher: string,
  params: Record<string, unknown> = {},
  options: QueryOptions = {},
): Promise<T[]> {
  try {
    const { records } = await getDriver().executeQuery<{ records: Array<{ toObject(): T }> }>(
      cypher,
      toBoltParameters(params),
      {
        database: getDatabaseName(),
        routing: options.write ? routing.WRITE : routing.READ,
        transactionConfig: { timeout: options.timeoutMs ?? QUERY_TIMEOUT_MS },
      },
    );
    return records.map((record) => record.toObject());
  } catch (error) {
    const dbError = toDatabaseError(error);
    // Server-side log keeps the raw cause; the browser only ever sees the
    // mapped message and detail.
    console.error(`[cognodb] ${dbError.kind}: ${dbError.message}`, {
      detail: dbError.detail,
      cypher: cypher.trim().split("\n")[0],
    });
    throw dbError;
  }
}

/** Convenience for the many queries that return exactly one row. */
export async function runQuerySingle<T extends RecordShape>(
  cypher: string,
  params: Record<string, unknown> = {},
  options: QueryOptions = {},
): Promise<T | null> {
  const rows = await runQuery<T>(cypher, params, options);
  return rows[0] ?? null;
}

export type HealthStatus =
  | { ok: true; latencyMs: number; address: string | null }
  | { ok: false; error: DatabaseError };

/** Cheap round trip used by the connection indicator in the header and /api/health. */
export async function checkHealth(): Promise<HealthStatus> {
  const startedAt = Date.now();
  try {
    const info = await getDriver().getServerInfo({ database: getDatabaseName() });
    return { ok: true, latencyMs: Date.now() - startedAt, address: info.address ?? null };
  } catch (error) {
    return { ok: false, error: toDatabaseError(error) };
  }
}

export async function closeDriver(): Promise<void> {
  if (global.__cognodbDriver) {
    await global.__cognodbDriver.close();
    global.__cognodbDriver = undefined;
  }
}
