import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { env } from "../env";

export type DB = PostgresJsDatabase<typeof schema>;

const g = globalThis as unknown as { __sdSql?: postgres.Sql; __sdDb?: DB };

export function sqlClient(): postgres.Sql {
  if (!g.__sdSql) {
    // Serverless-friendly: few connections, no prepared statements (works with pgbouncer / Neon pooler).
    g.__sdSql = postgres(env().DATABASE_URL, { max: 5, prepare: false, onnotice: () => {} });
  }
  return g.__sdSql;
}

export function db(): DB {
  if (!g.__sdDb) g.__sdDb = drizzle(sqlClient(), { schema });
  return g.__sdDb;
}

export async function closeDb() {
  await g.__sdSql?.end({ timeout: 5 });
  g.__sdSql = undefined;
  g.__sdDb = undefined;
}

export { schema };
