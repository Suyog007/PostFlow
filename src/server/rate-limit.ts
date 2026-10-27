import { lt, sql } from "drizzle-orm";
import { db, schema } from "./db/client";

/**
 * Counts one attempt for `key` and says whether it is over `max` in the current window.
 * Stored in Postgres so every server instance shares the count (in-memory counters reset whenever
 * a serverless instance is recycled and are not shared between instances).
 */
export async function hit(key: string, max: number, windowMs: number): Promise<boolean> {
  const reset = new Date(Date.now() + windowMs);
  const [row] = await db()
    .insert(schema.rateLimits)
    .values({ key, count: 1, resetAt: reset })
    .onConflictDoUpdate({
      target: schema.rateLimits.key,
      set: {
        count: sql`case when ${schema.rateLimits.resetAt} < now() then 1 else ${schema.rateLimits.count} + 1 end`,
        resetAt: sql`case when ${schema.rateLimits.resetAt} < now() then excluded.reset_at else ${schema.rateLimits.resetAt} end`,
      },
    })
    .returning({ count: schema.rateLimits.count });
  return row.count > max;
}

/** Whether `key` is already over `max`, without counting an attempt. */
export async function over(key: string, max: number): Promise<boolean> {
  const row = await db().query.rateLimits.findFirst({ where: (t, { eq }) => eq(t.key, key) });
  return !!row && row.resetAt > new Date() && row.count >= max;
}

export async function clear(key: string) {
  await db().delete(schema.rateLimits).where(sql`${schema.rateLimits.key} = ${key}`);
}

/** Drops finished windows. Called from the scheduler's daily cleanup. */
export async function pruneRateLimits() {
  await db().delete(schema.rateLimits).where(lt(schema.rateLimits.resetAt, new Date()));
}
