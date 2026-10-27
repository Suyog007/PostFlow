import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { warnOnError } from "./log";

/**
 * Takes the lease `name` for `ttlMs` if nobody holds a live one. Returns a holder id, or null.
 * One atomic statement, so it is safe through PgBouncer / Neon's pooled endpoint (session advisory
 * locks are not), and a process that dies just lets the lease run out.
 */
export async function acquireLease(name: string, ttlMs: number): Promise<string | null> {
  const holder = randomUUID();
  const expiresAt = new Date(Date.now() + ttlMs);
  const rows = await db()
    .insert(schema.leases)
    .values({ name, holder, expiresAt })
    .onConflictDoUpdate({ target: schema.leases.name, set: { holder, expiresAt }, setWhere: lt(schema.leases.expiresAt, sql`now()`) })
    .returning({ holder: schema.leases.holder });
  return rows[0]?.holder === holder ? holder : null;
}

export async function releaseLease(name: string, holder: string) {
  await db().delete(schema.leases).where(and(eq(schema.leases.name, name), eq(schema.leases.holder, holder)));
}

/**
 * Runs `fn` while holding the lease, waiting up to `waitMs` for it. Returns null when it stayed taken.
 * `ttlMs` must cover the longest `fn` can run: past it, another caller may start.
 */
export async function withLease<T>(name: string, ttlMs: number, fn: () => Promise<T>, waitMs = 0): Promise<T | null> {
  const until = Date.now() + waitMs;
  let holder: string | null;
  for (;;) {
    holder = await acquireLease(name, ttlMs);
    if (holder) break;
    if (Date.now() >= until) return null;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  try {
    return await fn();
  } finally {
    await releaseLease(name, holder).catch(warnOnError("lease_release_failed", { name }));
  }
}
