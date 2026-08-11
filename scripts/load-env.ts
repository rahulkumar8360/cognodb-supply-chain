import { existsSync } from "node:fs";
import path from "node:path";

import dotenv from "dotenv";

/**
 * Loads connection details for the standalone scripts.
 *
 * Next.js reads `.env.local` automatically, but `tsx scripts/seed.ts` runs
 * outside Next, so the scripts load the same files themselves — in the same
 * precedence order Next uses, and without ever overwriting a variable that is
 * already set (so CI secrets and `COGNODB_URI=... npm run seed` still win).
 */
export function loadEnvFiles(): void {
  const root = process.cwd();
  for (const file of [".env.local", ".env"]) {
    const fullPath = path.join(root, file);
    if (existsSync(fullPath)) {
      dotenv.config({ path: fullPath, override: false, quiet: true });
    }
  }
}
