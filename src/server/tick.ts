import { eq } from "drizzle-orm";
import { db, schema, sqlClient } from "./db/client";
import { collectFeeds, seedSourcesIfEmpty } from "./collect";
import { analyzeBatch } from "./analyze";
import { fillCalendar } from "./generate";
import { processRequests } from "./requests";
import { publishDue, reconcile } from "./publisher";
import { llmConfigured } from "./llm";
import { getSettings } from "./settings";
import { addEvent } from "./events";
import { log } from "./log";
import { recordHeartbeat } from "./health";
import { withUser } from "./context";
import { entitledUsers } from "./billing/plans";

export interface TickResult {
  skipped?: string;
  /** Users with an active plan (or owners). */
  users: number;
  /** Users whose writing pipeline ran in this pass. */
  served: number;
  published: number;
  collected: number;
  analyzed: number;
  produced: number;
  rejected: number;
  idle: string | null;
  errors: string[];
}

const LOCK_KEY = 874_201;
/** One user's writing pipeline may use at most this much of a pass, so nobody waits behind a slow account. */
const PER_USER_BUDGET_MS = 90_000;

const empty = (): TickResult => ({ users: 0, served: 0, published: 0, collected: 0, analyzed: 0, produced: 0, rejected: 0, idle: null, errors: [] });

async function publishPhase(out: TickResult) {
  const s = await getSettings();
  if (s.paused) return;
  try {
    await reconcile();
    out.published += (await publishDue()).published;
  } catch (err) {
    out.errors.push(`publish: ${(err as Error).message}`);
    log.error("tick_publish_failed", { error: (err as Error).message });
  }
}

async function pipelinePhase(out: TickResult, deadline: number) {
  const s = await getSettings();
  if (s.paused) return;
  // Things the user asked for come before anything the autopilot decides on its own.
  if (llmConfigured()) {
    try {
      await processRequests({ max: 2, deadline });
    } catch (err) {
      out.errors.push(`requests: ${(err as Error).message}`);
    }
  }
  await seedSourcesIfEmpty().catch(() => {});
  if (Date.now() < deadline) {
    try {
      out.collected += (await collectFeeds()).inserted;
    } catch (err) {
      out.errors.push(`collect: ${(err as Error).message}`);
    }
  }
  if (!llmConfigured()) {
    out.idle = "Fireworks is not configured";
    return;
  }
  if (Date.now() < deadline) {
    try {
      out.analyzed += await analyzeBatch();
    } catch (err) {
      out.errors.push(`analyze: ${(err as Error).message}`);
    }
  }
  if (Date.now() < deadline) {
    try {
      const f = await fillCalendar({ max: 2, deadline });
      out.produced += f.produced;
      out.rejected += f.rejected;
      out.idle = f.idle;
    } catch (err) {
      out.errors.push(`generate: ${(err as Error).message}`);
      await addEvent("error", `Generation failed: ${(err as Error).message}`);
    }
  }
}

/** One full pass for a single user (used by "Run now" in Settings). */
export async function runForUser(userId: string, opts: { budgetMs?: number } = {}): Promise<TickResult> {
  const out = empty();
  const deadline = Date.now() + (opts.budgetMs ?? PER_USER_BUDGET_MS);
  await withUser(userId, async () => {
    await publishPhase(out);
    await pipelinePhase(out, deadline);
  });
  await db().update(schema.users).set({ lastPipelineAt: new Date() }).where(eq(schema.users.id, userId));
  out.users = out.served = 1;
  return out;
}

/**
 * One scheduler pass for every active account. Safe to call every few minutes from any scheduler.
 * Publishing for everyone comes first, so a slow model call can never delay a due post.
 * The writing pipeline then serves accounts least-recently-served first until the time budget runs out.
 */
export async function tick(opts: { budgetMs?: number } = {}): Promise<TickResult> {
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? 200_000);
  const out = empty();

  // A session-level advisory lock keeps overlapping ticks from double-working.
  const conn = await sqlClient().reserve(); // lock and unlock must share one connection
  const [{ locked }] = (await conn`select pg_try_advisory_lock(${LOCK_KEY}) as locked`) as unknown as { locked: boolean }[];
  if (!locked) {
    conn.release();
    return { ...out, skipped: "another tick is running" };
  }
  try {
    await recordHeartbeat().catch(() => {});
    const users = await entitledUsers();
    out.users = users.length;

    for (const u of users) {
      await withUser(u.id, () => publishPhase(out)).catch((err) => out.errors.push(`publish(${u.id}): ${(err as Error).message}`));
    }

    const queue = [...users].sort((a, b) => (a.lastPipelineAt?.getTime() ?? 0) - (b.lastPipelineAt?.getTime() ?? 0));
    for (const u of queue) {
      // Leave room to finish cleanly.
      if (Date.now() > deadline - 15_000) break;
      const userDeadline = Math.min(deadline, Date.now() + PER_USER_BUDGET_MS);
      await withUser(u.id, () => pipelinePhase(out, userDeadline)).catch((err) => out.errors.push(`pipeline(${u.id}): ${(err as Error).message}`));
      await db().update(schema.users).set({ lastPipelineAt: new Date() }).where(eq(schema.users.id, u.id));
      out.served++;
    }
    return out;
  } finally {
    await conn`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
    conn.release();
  }
}
