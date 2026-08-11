import "server-only";

import { DatabaseError, SerializedDatabaseError, serializeDatabaseError, toDatabaseError } from "./errors";

export type Attempt<T> = { ok: true; data: T } | { ok: false; error: SerializedDatabaseError };

/**
 * Runs a query and converts a failure into a value instead of an exception.
 *
 * Server components could simply let the error propagate to the nearest
 * `error.tsx`, and for a genuine bug that is the right thing. But a sleeping
 * free-tier instance is not a bug, and blowing away the whole page — nav,
 * layout and all — to show a red screen makes the app feel broken when the fix
 * is to wait ten seconds and press retry. Turning the failure into a value lets
 * each panel fail on its own while the rest of the page keeps working.
 */
export async function attempt<T>(run: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    const databaseError = error instanceof DatabaseError ? error : toDatabaseError(error);
    return { ok: false, error: serializeDatabaseError(databaseError) };
  }
}
