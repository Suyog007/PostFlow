import { needsWelcome } from "./welcome";
import { and, desc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { db, schema } from "./db/client";
import { acquireLease, withLease } from "./lease";
import { pruneRateLimits } from "./rate-limit";
import { collectFeeds, seedSourcesIfEmpty } from "./collect";
import { analyzeBatch } from "./analyze";
import { fillCalendar, fillNowDays, extraQueuedLessons, rejectAndReplace, replaceDeclined, repeatedQueuedPosts, rewriteFresh, weakQueuedPosts, type FillResult } from "./generate";
import { env } from "./env";
import { formatLocal } from "./slots";
import { processRequests } from "./requests";
import { publishDue, reconcile } from "./publisher";
import { llmConfigured } from "./llm";
import { getSettings } from "./settings";
import { addEvent } from "./events";
import { log, warnOnError } from "./log";
import { recordHeartbeat } from "./health";
import { withUser } from "./context";
import { activePlatforms, CONNECT_FIRST, entitledUsers } from "./billing/plans";
import { notifyText } from "./telegram";

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

const TICK_LEASE = "tick";
/** Model calls can overrun a budget (one call may take minutes), so leases outlive budgets by this much. */
const LEASE_MARGIN_MS = 5 * 60_000;
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
  // Nothing is fetched, scored or written for an account that cannot publish yet (the owner is exempt).
  if (!(await activePlatforms()).length) {
    out.idle = "connect LinkedIn or X first";
    return;
  }
  // Until the welcome step names their field and topics, feeds would be the wrong ones for them.
  if (needsWelcome(s)) {
    out.idle = "finish the welcome step first";
    return;
  }
  // Things the user asked for come before anything the autopilot decides on its own.
  if (llmConfigured()) {
    try {
      await processRequests({ max: 2, deadline });
    } catch (err) {
      out.errors.push(`requests: ${(err as Error).message}`);
    }
  }
  await seedSourcesIfEmpty().catch(warnOnError("seed_sources_failed"));
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
      // Work through a backlog a few batches at a time, leaving room for writing.
      for (let i = 0; i < 3 && Date.now() < deadline - 45_000; i++) {
        const n = await analyzeBatch();
        out.analyzed += n;
        if (n === 0) break;
      }
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
  await withUserLock(userId, () => withUser(userId, () => pipelinePhase(out, deadline)), 0, opts.budgetMs ?? PER_USER_BUDGET_MS);
  await db().update(schema.users).set({ lastPipelineAt: new Date() }).where(eq(schema.users.id, userId));
  out.users = out.served = 1;
  return out;
}

/** Holds this account's writer lease while `fn` runs, so "Fill now" and the scheduler never write the same slot twice. */
async function withUserLock<T>(userId: string, fn: () => Promise<T>, waitMs = 0, budgetMs = PER_USER_BUDGET_MS): Promise<T | null> {
  return withLease(`user:${userId}`, budgetMs + LEASE_MARGIN_MS, fn, waitMs);
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
        if (!(await activePlatforms()).length) {
          await addEvent("fill_done", "Fill skipped: connect LinkedIn or X in Settings first.");
          return null;
        }
        await collectFeeds({ maxFeeds: 20, minIntervalMinutes: 30 }).catch(warnOnError("fill_now_collect_failed", { userId }));
        if (!llmConfigured()) {
          await addEvent("fill_done", "Fill skipped: the AI model is not configured.");
          return null;
        }
        for (let i = 0; i < 8 && Date.now() < deadline - 5 * 60_000; i++) if (!(await analyzeBatch().catch(() => 0))) break;
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
        const summary = `Filled the calendar: ${f.produced} new post${f.produced === 1 ? "" : "s"}, ${f.rejected} held back by the reviewer.${tail}`;
        await addEvent("fill_done", summary.slice(0, 500));
        await notifyText(`✅ ${summary}\n\nSend /queue to review the posts.`).catch(warnOnError("notify_failed", { what: "fill done" }));
        return f;
      }),
    3 * 60_000,
    opts.budgetMs ?? 10 * 60_000,
  );
}

/**
 * Starts "Fill now" for one user, from the site or from Telegram. Returns a short message for them.
 * `fallback` runs the job in-process when the background function is not available (local development).
 */
export async function requestFillNow(userId: string, fallback: (job: () => Promise<unknown>) => void): Promise<string> {
  const message = await withUser(userId, async () => {
    const s = await getSettings();
    if (s.paused) throw new Error("Autopilot is paused. Resume it first.");
    if (!(await activePlatforms()).length) throw new Error(CONNECT_FIRST);
    const [last] = await db().select().from(schema.events).where(and(eq(schema.events.userId, userId), inArray(schema.events.kind, ["fill", "fill_done"]))).orderBy(desc(schema.events.at)).limit(1);
    if (last?.kind === "fill" && Date.now() - last.at.getTime() < 10 * 60_000) throw new Error("Already filling your calendar. New posts appear as they are written.");
    await addEvent("fill", `Filling the next ${fillNowDays(s)} days…`);
    return `Filling the next ${fillNowDays(s)} days.`;
  });
  if (!(await startBackgroundFill(userId))) fallback(() => fillNowForUser(userId, { budgetMs: 4 * 60_000 }).then(() => undefined).catch(warnOnError("fill_now_failed", { userId })));
  return message;
}

/**
 * Rewrites every queued post that is not approved or edited, with the current writing rules.
 * Runs in the background function, then reports by Telegram.
 */
export async function refreshQueuedForUser(userId: string, opts: { budgetMs?: number } = {}): Promise<{ rewritten: number; kept: number } | null> {
  const deadline = Date.now() + (opts.budgetMs ?? 10 * 60_000);
  return withUserLock(
    userId,
    () =>
      withUser(userId, async () => {
        const queued = await db()
          .select({ id: schema.posts.id })
          .from(schema.posts)
          .where(and(eq(schema.posts.userId, userId), eq(schema.posts.status, "scheduled"), eq(schema.posts.userEdited, false), isNull(schema.posts.approvedAt), gt(schema.posts.scheduledAt, new Date(Date.now() + 15 * 60_000))))
          .orderBy(schema.posts.scheduledAt)
          .limit(30);
        let rewritten = 0;
        let kept = 0;
        let swapped = 0;
        // The same story told twice (on X and LinkedIn, or from two articles) is swapped for a different story first.
        // So is a story that no longer clears the bar (the scorer is stricter about routine releases now).
        // And written lessons beyond one a day give their slot back to news.
        const s = await getSettings();
        const repeats = new Set([...(await repeatedQueuedPosts()), ...(await weakQueuedPosts(s)), ...(await extraQueuedLessons(s))]);
        for (const q of queued) {
          if (Date.now() > deadline) break;
          if (repeats.has(q.id)) {
            try {
              const r = await rejectAndReplace(q.id);
              if (r.replacementId) swapped++;
            } catch (err) {
              log.warn("swap_repeat_failed", { postId: q.id, error: (err as Error).message });
            }
            continue;
          }
          try {
            if ((await rewriteFresh(q.id)) === "rewritten") rewritten++;
            else kept++;
          } catch (err) {
            kept++;
            log.warn("rewrite_failed", { postId: q.id, error: (err as Error).message });
          }
        }
        const summary = `Rewrote ${rewritten} queued post${rewritten === 1 ? "" : "s"} in the new style${kept ? `, and kept ${kept} where the new draft was not better` : ""}.${repeats.size ? ` ${repeats.size} repeated a story, was not interesting enough or was one lesson too many for the day: ${swapped} swapped for a different story${repeats.size - swapped ? `, ${repeats.size - swapped} removed (nothing new was strong enough)` : ""}.` : ""}`;
        await addEvent("refresh_done", summary);
        await notifyText(`✅ ${summary}\n\nSend /queue to see them.`).catch(warnOnError("notify_failed", { what: "refresh done" }));
        return { rewritten, kept };
      }),
    3 * 60_000,
    opts.budgetMs ?? 10 * 60_000,
  );
}

/** Starts "Rewrite queued posts" for one user, from the site or Telegram. */
export async function requestRefresh(userId: string, fallback: (job: () => Promise<unknown>) => void): Promise<string> {
  await withUser(userId, async () => {
    const [last] = await db().select().from(schema.events).where(and(eq(schema.events.userId, userId), inArray(schema.events.kind, ["refresh", "refresh_done"]))).orderBy(desc(schema.events.at)).limit(1);
    if (last?.kind === "refresh" && Date.now() - last.at.getTime() < 15 * 60_000) throw new Error("Already rewriting your queued posts. I will message you when it is done.");
    await addEvent("refresh", "Rewriting queued posts in the new style…");
  });
  if (!(await startBackgroundJob(userId, "refresh"))) fallback(() => refreshQueuedForUser(userId, { budgetMs: 4 * 60_000 }).then(() => undefined).catch(warnOnError("refresh_failed", { userId })));
  return "Rewriting your queued posts in the new style. Posts you approved or edited stay as they are.";
}

/** Starts "Fill now" in the background function. False when that is not available (local dev). */
export async function startBackgroundFill(userId: string): Promise<boolean> {
  return startBackgroundJob(userId, "fill");
}

/**
 * "Find another story": writing the replacement takes longer than a web request may run (about 30 s on
 * Netlify), so it runs in the background function. The result arrives on the calendar and in Telegram.
 */
export async function requestReplacement(userId: string, postId: string, fallback: (job: () => Promise<unknown>) => void): Promise<void> {
  if (await startBackgroundJob(userId, "replace", postId)) return;
  fallback(() => replaceForUser(userId, postId).catch(warnOnError("replace_failed", { userId })));
}

/** Writes the replacement for a declined post and tells the owner on Telegram when none could be found. */
export async function replaceForUser(userId: string, postId: string): Promise<{ replacementId: string | null; message: string }> {
  return withUser(userId, async () => {
    const r = await replaceDeclined(postId).catch((err: Error) => ({ replacementId: null, message: err.message }));
    if (!r.replacementId) await notifyText(`ℹ️ ${r.message}`).catch(warnOnError("notify_failed", { what: "replace" }));
    return r;
  });
}

async function startBackgroundJob(userId: string, job: "fill" | "refresh" | "replace", postId?: string): Promise<boolean> {
  const e = env();
  if (!e.CRON_SECRET) return false;
  const base = e.APP_URL.replace(/\/$/, "").replace(/^http:\/\/(?!localhost)/, "https://");
  try {
    const res = await fetch(`${base}/.netlify/functions/tick-background`, {
      method: "POST",
      headers: { authorization: `Bearer ${e.CRON_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify(job === "fill" ? { fillUserId: userId } : job === "replace" ? { replaceUserId: userId, replacePostId: postId } : { refreshUserId: userId }),
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
  const budget = opts.budgetMs ?? 200_000;
  const deadline = started + budget;
  const out = empty();

  await recordHeartbeat().catch(warnOnError("heartbeat_failed"));
  const users = await entitledUsers();
  out.users = users.length;

  // Publishing runs on every pass, even while another pass is still writing: claims are row-locked
  // (for update skip locked), so overlapping passes never post the same thing twice.
  for (const u of users) {
    await withUser(u.id, () => publishPhase(out)).catch((err) => out.errors.push(`publish(${u.id}): ${(err as Error).message}`));
  }

  // Writing is the slow part; one pass at a time does it.
  const ran = await withLease(TICK_LEASE, budget + LEASE_MARGIN_MS, async () => {
    const queue = [...users].sort((a, b) => (a.lastPipelineAt?.getTime() ?? 0) - (b.lastPipelineAt?.getTime() ?? 0));
    for (const u of queue) {
      // Leave room to finish cleanly.
      if (Date.now() > deadline - 15_000) break;
      const userDeadline = Math.min(deadline, Date.now() + PER_USER_BUDGET_MS);
      // Skipped while "Fill now" is working on this account (and then not marked as served).
      const done = await withUserLock(u.id, async () => {
        await withUser(u.id, () => pipelinePhase(out, userDeadline));
        return true;
      }).catch((err) => {
        out.errors.push(`pipeline(${u.id}): ${(err as Error).message}`);
        return true;
      });
      if (!done) continue;
      await db().update(schema.users).set({ lastPipelineAt: new Date() }).where(eq(schema.users.id, u.id));
      out.served++;
    }
    await dailyCleanup().catch(warnOnError("cleanup_failed"));
    return true;
  });
  if (!ran) out.skipped = "another tick is writing";
  if (out.errors.length) await alertOwners(out).catch(warnOnError("alert_failed"));
  return out;
}

const DAY = 86_400_000;

/**
 * Once a day: drops rows nothing reads any more, so tables do not grow forever.
 * The lease is not released, so this runs at most once per 24 hours whichever pass gets there first.
 */
async function dailyCleanup() {
  if (!(await acquireLease("cleanup:daily", DAY))) return;
  const now = Date.now();
  await db().delete(schema.events).where(lt(schema.events.at, new Date(now - 90 * DAY)));
  await db().delete(schema.llmCalls).where(lt(schema.llmCalls.createdAt, new Date(now - 180 * DAY)));
  await db().delete(schema.emailTokens).where(lt(schema.emailTokens.expiresAt, new Date(now - 7 * DAY)));
  await db().delete(schema.oauthStates).where(lt(schema.oauthStates.expiresAt, new Date(now)));
  await db().delete(schema.leases).where(lt(schema.leases.expiresAt, new Date(now)));
  await pruneRateLimits();
  log.info("daily_cleanup_done", {});
}

/** Tells the owners on Telegram when a pass had errors. At most once an hour, so a persistent fault does not flood. */
async function alertOwners(out: TickResult) {
  log.error("tick_errors", { errors: out.errors.slice(0, 10) });
  if (!(await acquireLease("alert:tick-errors", 60 * 60_000))) return;
  const owners = await db().select().from(schema.users).where(eq(schema.users.isOwner, true));
  const text = `⚠️ Scheduler pass had ${out.errors.length} error${out.errors.length === 1 ? "" : "s"} (users ${out.users}, served ${out.served}, published ${out.published}):\n\n${out.errors.slice(0, 5).map((e) => `• ${e.slice(0, 300)}`).join("\n")}\n\nMore in the function logs. Next alert in an hour at the earliest.`;
  for (const o of owners) {
    if (!env().OWNER_EMAILS.includes(o.email)) continue;
    await withUser(o.id, () => notifyText(text)).catch(warnOnError("alert_send_failed"));
  }
}
