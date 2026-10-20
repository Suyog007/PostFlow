import { sqlClient } from "./db/client";
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

export interface TickResult {
  skipped?: string;
  published: number;
  collected: number;
  analyzed: number;
  produced: number;
  rejected: number;
  idle: string | null;
  errors: string[];
}

const LOCK_KEY = 874_201;

/**
 * One scheduler pass. Safe to call every few minutes from any scheduler.
 * Publishing always comes first so a slow model call can never delay a due post.
 */
export async function tick(opts: { budgetMs?: number } = {}): Promise<TickResult> {
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? 200_000);
  const out: TickResult = { published: 0, collected: 0, analyzed: 0, produced: 0, rejected: 0, idle: null, errors: [] };

  // A session-level advisory lock keeps overlapping ticks from double-working.
  const conn = await sqlClient().reserve(); // lock and unlock must share one connection
  const [{ locked }] = (await conn`select pg_try_advisory_lock(${LOCK_KEY}) as locked`) as unknown as { locked: boolean }[];
  if (!locked) {
    conn.release();
    return { ...out, skipped: "another tick is running" };
  }
  try {
    await recordHeartbeat().catch(() => {});
    const s = await getSettings();
    if (s.paused) return { ...out, skipped: "paused" };

    try {
      await reconcile();
      const p = await publishDue();
      out.published = p.published;
    } catch (err) {
      out.errors.push(`publish: ${(err as Error).message}`);
      log.error("tick_publish_failed", { error: (err as Error).message });
    }

    // Things you asked for come before anything the autopilot decides on its own.
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
        out.collected = (await collectFeeds()).inserted;
      } catch (err) {
        out.errors.push(`collect: ${(err as Error).message}`);
      }
    }
    if (!llmConfigured()) {
      out.idle = "Fireworks is not configured";
      return out;
    }
    if (Date.now() < deadline) {
      try {
        out.analyzed = await analyzeBatch();
      } catch (err) {
        out.errors.push(`analyze: ${(err as Error).message}`);
      }
    }
    if (Date.now() < deadline) {
      try {
        const f = await fillCalendar({ max: 2, deadline });
        out.produced = f.produced;
        out.rejected = f.rejected;
        out.idle = f.idle;
      } catch (err) {
        out.errors.push(`generate: ${(err as Error).message}`);
        await addEvent("error", `Generation failed: ${(err as Error).message}`);
      }
    }
    return out;
  } finally {
    await conn`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
    conn.release();
  }
}

