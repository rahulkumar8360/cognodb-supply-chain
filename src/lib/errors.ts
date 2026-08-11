import { MissingConfigError } from "./env";

/**
 * A database failure translated into something the UI can render.
 *
 * Every query goes through `runQuery`, which catches driver errors and maps
 * them onto one of these kinds. The UI then decides what to show: an
 * "unreachable" banner with retry, a configuration checklist, or a generic
 * error card. Raw driver messages are kept in `detail` for the server log but
 * are only surfaced to the browser when they are safe (they can contain the
 * host name, never the password).
 */
export type DatabaseErrorKind =
  | "unconfigured" // env vars are missing
  | "unreachable" // DNS/TCP/TLS failure, instance asleep or deleted
  | "unauthorized" // bad username or password
  | "timeout" // query exceeded the deadline
  | "query" // the Cypher itself was rejected
  | "unknown";

export class DatabaseError extends Error {
  readonly kind: DatabaseErrorKind;
  readonly detail: string;
  /** True when retrying the same request might succeed. */
  readonly retryable: boolean;

  constructor(kind: DatabaseErrorKind, message: string, detail: string, retryable: boolean) {
    super(message);
    this.name = "DatabaseError";
    this.kind = kind;
    this.detail = detail;
    this.retryable = retryable;
  }
}

/** Neo4j driver errors carry a `code` like "Neo.ClientError.Security.Unauthorized". */
function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Maps a thrown value from the driver onto a `DatabaseError`.
 *
 * The driver signals service-level problems through `code` values on
 * `Neo4jError` and through Node's own socket error codes (ENOTFOUND,
 * ECONNREFUSED, ETIMEDOUT) nested in the cause chain, so both are checked.
 */
export function toDatabaseError(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) return error;

  if (error instanceof MissingConfigError) {
    return new DatabaseError("unconfigured", error.message, error.missing.join(", "), false);
  }

  const code = errorCode(error);
  const message = errorMessage(error);
  const haystack = `${code} ${message}`;

  if (code === "Neo.ClientError.Security.Unauthorized" || /authentication|unauthorized/i.test(haystack)) {
    return new DatabaseError(
      "unauthorized",
      "The database rejected these credentials.",
      "Check COGNODB_USERNAME and COGNODB_PASSWORD. CognoDB shows the generated password only once at instance creation.",
      false,
    );
  }

  if (
    code === "ServiceUnavailable" ||
    code === "SessionExpired" ||
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EPIPE|could not perform discovery|connection acquisition|WebSocket connection failure|Failed to connect/i.test(
      haystack,
    )
  ) {
    return new DatabaseError(
      "unreachable",
      "Can't reach the database right now.",
      "The CognoDB instance may be paused, still provisioning, or blocked by the network. Free-tier instances sleep when idle.",
      true,
    );
  }

  if (code === "Neo.ClientError.Transaction.TransactionTimedOut" || /ETIMEDOUT|timed? ?out/i.test(haystack)) {
    return new DatabaseError(
      "timeout",
      "The query took too long and was cancelled.",
      "Free-tier instances are burstable and share 0.5 vCPU; deep traversals can exceed the deadline under load.",
      true,
    );
  }

  if (code.startsWith("Neo.ClientError") || code.startsWith("Neo.DatabaseError")) {
    return new DatabaseError("query", "The database rejected this query.", message, false);
  }

  return new DatabaseError("unknown", "Something went wrong talking to the database.", message, true);
}

/** Serialisable form, safe to pass from a server component into a client component. */
export type SerializedDatabaseError = {
  kind: DatabaseErrorKind;
  message: string;
  detail: string;
  retryable: boolean;
};

export function serializeDatabaseError(error: DatabaseError): SerializedDatabaseError {
  return {
    kind: error.kind,
    message: error.message,
    detail: error.detail,
    retryable: error.retryable,
  };
}
