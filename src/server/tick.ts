import { eq } from "drizzle-orm";
import { db, schema, sqlClient } from "./db/client";
import { collectFeeds, seedSourcesIfEmpty } from "./collect";
import { analyzeBatch } from "./analyze";
import { fillCalendar, fillNowDays, type FillResult } from "./generate";
import { env } from "./env";
import { formatLocal } from "./slots";
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
const USER_LOCK_KEY = 874_202;
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
  await withUser(userId, () => publishPhase(out));
  await withUserLock(userId, () => withUser(userId, () => pipelinePhase(out, deadline)));
  await db().update(schema.users).set({ lastPipelineAt: new Date() }).where(eq(schema.users.id, userId));
  out.users = out.served = 1;
  return out;
}

/** Holds a per-account lock while `fn` runs, so "Fill now" and the scheduler never write the same slot twice. */
async function withUserLock<T>(userId: string, fn: () => Promise<T>, waitMs = 0): Promise<T | null> {
  const conn = await sqlClient().reserve();
  try {
    const until = Date.now() + waitMs;
    for (;;) {
      const [{ locked }] = (await conn`select pg_try_advisory_lock(${USER_LOCK_KEY}, hashtext(${userId})) as locked`) as unknown as { locked: boolean }[];
      if (locked) break;
      if (Date.now() >= until) return null;
      await new Promise((r) => setTimeout(r, 3_000));
    }
    try {
      return await fn();
    } finally {
      await conn`select pg_advisory_unlock(${USER_LOCK_KEY}, hashtext(${userId}))`.catch(() => {});
    }
  } finally {
    conn.release();
  }
}

/**
 * "Fill now": collects fresh stories, then writes for every open slot in the planning window,
 * giving slots that failed earlier a fresh set of attempts. Runs in the background function.
 */
export async function fillNowForUser(userId: string, opts: { budgetMs?: number } = {}): Promise<FillResult | null> {
  const deadline = Date.now() + (opts.budgetMs ?? 10 * 60_000);
  const since = new Date();
  return withUserLock(
    userId,
    () =>
      withUser(userId, async () => {
        const s = await getSettings();
        if (s.paused) {
          await addEvent("fill_done", "Fill skipped: autopilot is paused.");
          return null;
        }
        await collectFeeds({ maxFeeds: 20, minIntervalMinutes: 30 }).catch(() => {});
        if (!llmConfigured()) {
          await addEvent("fill_done", "Fill skipped: the AI model is not configured.");
          return null;
        }
        await analyzeBatch().catch(() => 0);
        await analyzeBatch().catch(() => 0);
        let f: FillResult;
        try {
          f = await fillCalendar({ max: 30, deadline, retryFailedSince: since, horizonDays: fillNowDays(s) });
        } catch (err) {
          await addEvent("fill_done", `Fill stopped: ${(err as Error).message}`);
          throw err;
        }
        const waiting = f.waiting ?? [];
        const tail = waiting.length
          ? ` ${waiting.length} open slot${waiting.length === 1 ? "" : "s"} (${waiting.map((w) => `${w.platform === "x" ? "X" : "LinkedIn"} ${formatLocal(w.at, s.timezone)}`).join(", ")}) have no story that will still be fresh by then; autopilot fills them as new stories come in.`
          : f.idle && f.idle !== "calendar full" && f.idle !== "nothing worth posting right now" ? ` Stopped because: ${f.idle}.` : "";
        await addEvent("fill_done", `Filled the calendar: ${f.produced} new post${f.produced === 1 ? "" : "s"}, ${f.rejected} held back by the reviewer.${tail}`.slice(0, 500));
        return f;
      }),
    3 * 60_000,
  );
}

/** Starts "Fill now" in the background function. False when that is not available (local dev). */
export async function startBackgroundFill(userId: string): Promise<boolean> {
  const e = env();
  if (!e.CRON_SECRET) return false;
  const base = e.APP_URL.replace(/\/$/, "").replace(/^http:\/\/(?!localhost)/, "https://");
  try {
    const res = await fetch(`${base}/.netlify/functions/tick-background`, {
      method: "POST",
      headers: { authorization: `Bearer ${e.CRON_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ fillUserId: userId }),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    return res.status === 202;
  } catch {
    return false;
  }
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
      // Skipped while "Fill now" is working on this account.
      await withUserLock(u.id, () => withUser(u.id, () => pipelinePhase(out, userDeadline))).catch((err) => out.errors.push(`pipeline(${u.id}): ${(err as Error).message}`));
      await db().update(schema.users).set({ lastPipelineAt: new Date() }).where(eq(schema.users.id, u.id));
      out.served++;
    }
    return out;
  } finally {
    await conn`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
    conn.release();
  }
}
