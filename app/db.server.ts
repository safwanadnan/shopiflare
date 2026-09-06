import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";

export function getDb(env: Env) {
  if (!env.DB) {
    throw new Error(
      "[Shopiflare] Missing D1 Database binding 'DB'. Please configure your d1_databases in wrangler.jsonc.",
    );
  }
  return drizzle(env.DB, { schema });
}

export type AppDb = ReturnType<typeof getDb>;

// Backwards-compatibility alias with helpful deprecation guidance
export function getPrisma(env: Env): AppDb {
  return getDb(env);
}
