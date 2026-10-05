/**
 * PostFlow background worker. Run alongside the web app: `npm run worker`.
 * - publishes due posts (the only process that publishes on a schedule)
 * - reconciles ambiguous publication results
 * - flags stale time-sensitive posts for review
 * - runs discovery at the configured local times and on manual request
 * All state lives in Postgres, so restarts are safe.
 */
import { DateTime } from "luxon";
import { and, eq, gte } from "drizzle-orm";
import { loadDotEnv } from "../scripts/load-env";
loadDotEnv();

const { db, schema, closeDb } = await import("../src/server/db/client");
const { publishDue, reconcile, flagStale } = await import("../src/server/publishing/publisher");
const { claimNextJob, runJob, enqueueDiscovery, failAbandonedJobs, recordJob } = await import("../src/server/jobs");
const { collectXMetrics } = await import("../src/server/metrics");
const { getUserPreferences } = await import("../src/server/preferences");
const { ensureOwner } = await import("../src/server/users");
const { log } = await import("../src/server/log");

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

const every = (ms: number) => {
  let last = 0;
  return () => {
    if (Date.now() - last < ms) return false;
    last = Date.now();
    return true;
  };
};

async function maybeScheduleDiscovery(userId: string) {
  const prefs = await getUserPreferences(userId);
  const nowLocal = DateTime.now().setZone(prefs.timezone);
  for (const t of prefs.discovery.autoRunTimes) {
    const [h, m] = t.split(":").map(Number);
    const slot = nowLocal.set({ hour: h, minute: m, second: 0, millisecond: 0 });
    if (nowLocal < slot || nowLocal.diff(slot, "hours").hours > 3) continue;
    const already = await db().query.jobRuns.findFirst({
      where: and(eq(schema.jobRuns.kind, "discovery"), gte(schema.jobRuns.queuedAt, slot.toJSDate())),
    });
    if (!already) {
      log.info("discovery_scheduled", { slot: t });
      await enqueueDiscovery(userId, "schedule");
    }
  }
}

async function main() {
  const owner = await ensureOwner();
  log.info("worker_started", { pid: process.pid });
  const publishTick = every(20_000);
  const reconcileTick = every(60_000);
  const staleTick = every(10 * 60_000);
  const scheduleTick = every(60_000);
  const metricsTick = every(6 * 3_600_000);

  while (!stopping) {
    try {
      if (publishTick()) {
        const out = await publishDue();
        if (Object.keys(out).length) {
          log.info("publish_tick", out);
          await recordJob("publish", out);
        }
      }
      if (reconcileTick()) {
        const r = await reconcile();
        if (r.stuck || Object.keys(r.results).length) await recordJob("reconcile", r as unknown as Record<string, unknown>);
        await failAbandonedJobs();
      }
      if (staleTick()) {
        const n = await flagStale();
        if (n) await recordJob("staleness", { flagged: n });
      }
      if (metricsTick()) {
        const m = await collectXMetrics();
        if (m.updated) await recordJob("metrics", m as unknown as Record<string, unknown>);
        log.info("metrics_tick", m);
      }
      if (scheduleTick()) await maybeScheduleDiscovery(owner.id);
      const job = await claimNextJob();
      if (job) await runJob(job);
    } catch (err) {
      log.error("worker_tick_failed", { error: (err as Error).message });
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  log.info("worker_stopping", {});
  await closeDb();
}

await main();
