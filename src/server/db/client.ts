import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { env } from "../env";

export type DB = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __sdSql?: postgres.Sql; __sdDb?: DB };

export function sqlClient(): postgres.Sql {
  if (!globalForDb.__sdSql) {
    globalForDb.__sdSql = postgres(env().DATABASE_URL, { max: 10, onnotice: () => {} });
  }
  return globalForDb.__sdSql;
}

export function db(): DB {
  if (!globalForDb.__sdDb) globalForDb.__sdDb = drizzle(sqlClient(), { schema });
  return globalForDb.__sdDb;
}

export async function closeDb() {
  await globalForDb.__sdSql?.end({ timeout: 5 });
  globalForDb.__sdSql = undefined;
  globalForDb.__sdDb = undefined;
}

export { schema };
