/**
 * Environment configuration.
 *
 * Connection details for CognoDB are read from the environment and never
 * committed. `.env.example` documents the shape; `.env.local` (git-ignored)
 * holds the real values in development, and the same variables are set as
 * project secrets on the hosting provider in production.
 */

export type DatabaseConfig = {
  uri: string;
  username: string;
  password: string;
  database: string;
};

export class MissingConfigError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(
      `Missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. ` +
        `Copy .env.example to .env.local and fill in your CognoDB connection details.`,
    );
    this.name = "MissingConfigError";
    this.missing = missing;
  }
}

/**
 * Reads and validates the database configuration.
 *
 * Throws `MissingConfigError` rather than falling back to a default so that a
 * misconfigured deployment fails loudly with an actionable message instead of
 * silently trying to reach localhost.
 */
export function readDatabaseConfig(): DatabaseConfig {
  const uri = process.env.COGNODB_URI?.trim();
  const username = process.env.COGNODB_USERNAME?.trim() || "cognodb";
  const password = process.env.COGNODB_PASSWORD;
  const database = process.env.COGNODB_DATABASE?.trim() || "neo4j";

  const missing: string[] = [];
  if (!uri) missing.push("COGNODB_URI");
  if (!password) missing.push("COGNODB_PASSWORD");
  if (missing.length > 0) throw new MissingConfigError(missing);

  return { uri: uri!, username, password: password!, database };
}
