import { and, eq, lt, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { runDiscovery } from "./discovery/pipeline";
import { log } from "./log";

export async function enqueueDiscovery(userId: string, trigger: "manual" | "schedule") {
  // Do not stack up duplicate runs.
  const pending = await db().query.jobRuns.findFirst({
    where: and(eq(schema.jobRuns.kind, "discovery"), sql`${schema.jobRuns.status} in ('queued','running')`),
  });
  if (pending) return pending.id;
  const [j] = await db().insert(schema.jobRuns).values({ kind: "discovery", trigger, payload: { userId, force: trigger === "manual" } }).returning();
  return j.id;
}

export async function claimNextJob() {
  const rows = await db().execute(sql`
    update job_runs set status = 'running', started_at = now()
    where id = (select id from job_runs where status = 'queued' order by queued_at for update skip locked limit 1)
    returning id`);
  if (rows.length === 0) return null;
  return db().query.jobRuns.findFirst({ where: eq(schema.jobRuns.id, rows[0].id as string) });
}

export async function runJob(job: typeof schema.jobRuns.$inferSelect) {
  try {
    if (job.kind !== "discovery") throw new Error(`Unknown job kind ${job.kind}`);
    const p = job.payload as { userId: string; force?: boolean };
    const stats = await runDiscovery(p.userId, { force: p.force, jobRunId: job.id });
    await db().update(schema.jobRuns).set({ status: "succeeded", stats, finishedAt: new Date() }).where(eq(schema.jobRuns.id, job.id));
    log.info("job_succeeded", { id: job.id, kind: job.kind, stats: stats as unknown as Record<string, unknown> });
  } catch (err) {
    await db().update(schema.jobRuns).set({ status: "failed", error: (err as Error).message.slice(0, 1000), finishedAt: new Date() }).where(eq(schema.jobRuns.id, job.id));
    log.error("job_failed", { id: job.id, error: (err as Error).message });
  }
}

/** Jobs left "running" by a crashed worker. */
export async function failAbandonedJobs() {
  await db()
    .update(schema.jobRuns)
    .set({ status: "failed", error: "Worker stopped during the run.", finishedAt: new Date() })
    .where(and(eq(schema.jobRuns.status, "running"), lt(schema.jobRuns.startedAt, new Date(Date.now() - 45 * 60_000))));
}

export async function recordJob(kind: string, stats: Record<string, unknown>, error?: string) {
  await db().insert(schema.jobRuns).values({ kind, trigger: "schedule", status: error ? "failed" : "succeeded", stats, error, startedAt: new Date(), finishedAt: new Date() });
}
