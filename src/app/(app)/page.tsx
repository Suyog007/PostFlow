import Link from "next/link";
import { DateTime } from "luxon";
import { and, desc, gte, lt } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { getSettings } from "@/server/settings";
import { healthChecks } from "@/server/health";
import { recentEvents } from "@/server/events";
import { Flash } from "./flash";

type Post = typeof schema.posts.$inferSelect;

const STATUS_STYLE: Record<string, string> = {
  scheduled: "border-accent",
  publishing: "border-accent",
  published: "border-good opacity-80",
  unconfirmed: "border-warn",
  failed: "border-bad",
  cancelled: "border-line opacity-50 line-through",
  expired: "border-line opacity-50",
};

function PostChip({ p, tz }: { p: Post; tz: string }) {
  return (
    <Link href={`/posts/${p.id}`} className={`block rounded-lg border-l-4 bg-card px-2.5 py-2 text-xs shadow-sm hover:bg-paper ${STATUS_STYLE[p.status] ?? "border-line"}`}>
      <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted">
        <span className={`font-semibold ${p.platform === "x" ? "text-x" : "text-li"}`}>{p.platform === "x" ? "X" : "in"}</span>
        <span>{DateTime.fromJSDate(p.scheduledAt, { zone: tz }).toFormat("HH:mm")}</span>
        {p.expiresAt && <span title="Time-sensitive">⏱</span>}
        {p.userEdited && <span title="Edited by you">✎</span>}
        {p.status !== "scheduled" && <span className="ml-auto uppercase">{p.status}</span>}
      </div>
      <div className="line-clamp-3 break-words">{p.text}</div>
    </Link>
  );
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ w?: string; ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const s = await getSettings();
  const offset = Number(sp.w ?? 0) || 0;
  const weekStart = DateTime.now().setZone(s.timezone).startOf("week").plus({ weeks: offset });
  const weekEnd = weekStart.plus({ weeks: 1 });
  const posts = await db()
    .select()
    .from(schema.posts)
    .where(and(gte(schema.posts.scheduledAt, weekStart.toJSDate()), lt(schema.posts.scheduledAt, weekEnd.toJSDate())))
    .orderBy(schema.posts.scheduledAt);
  const shown = posts.filter((p) => p.status !== "rejected");
  const rejected = await db().select().from(schema.posts).where(and(gte(schema.posts.scheduledAt, new Date(Date.now() - 3 * 86_400_000)))).orderBy(desc(schema.posts.createdAt)).limit(40);
  const rej = rejected.filter((p) => p.status === "rejected" && p.text).slice(0, 5);
  const checks = (await healthChecks()).filter((c) => !c.ok);
  const critical = checks.filter((c) => c.critical);
  const events = await recentEvents(12);
  const today = DateTime.now().setZone(s.timezone).toISODate();

  return (
    <div>
      <Flash ok={sp.ok} error={sp.error} />
      {critical.length > 0 && (
        <div className="mb-4 rounded-lg border border-warn bg-card px-4 py-3 text-sm">
          <p className="mb-1 font-medium">Finish setup so autopilot can run:</p>
          <ul className="list-disc pl-5 text-muted">
            {critical.map((c) => (
              <li key={c.label}>
                <strong className="text-ink">{c.label}.</strong> {c.hint}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mb-3 flex items-center gap-2">
        <h1 className="text-lg font-semibold">{weekStart.toFormat("d LLL")} – {weekEnd.minus({ days: 1 }).toFormat("d LLL yyyy")}</h1>
        <div className="ml-auto flex gap-1">
          <Link href={`/?w=${offset - 1}`} className="btn-secondary">←</Link>
          <Link href="/" className="btn-secondary">Today</Link>
          <Link href={`/?w=${offset + 1}`} className="btn-secondary">→</Link>
        </div>
      </div>
      <p className="mb-4 text-sm text-muted">Everything shown will be posted automatically at its time. Open a post to edit, move or remove it.</p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => {
          const day = weekStart.plus({ days: i });
          const dayPosts = shown.filter((p) => DateTime.fromJSDate(p.scheduledAt, { zone: s.timezone }).hasSame(day, "day"));
          return (
            <div key={i} className={`card min-h-24 p-2 ${day.toISODate() === today ? "ring-2 ring-accent-soft" : ""}`}>
              <div className="mb-2 text-xs font-medium text-muted">{day.toFormat("ccc d")}</div>
              <div className="space-y-2">
                {dayPosts.length ? dayPosts.map((p) => <PostChip key={p.id} p={p} tz={s.timezone} />) : <p className="text-xs text-muted/70">—</p>}
              </div>
            </div>
          );
        })}
      </div>

      {rej.length > 0 && (
        <details className="mt-6 text-sm">
          <summary className="cursor-pointer text-muted">The reviewer rejected {rej.length} recent draft(s)</summary>
          <ul className="mt-2 space-y-2">
            {rej.map((p) => (
              <li key={p.id} className="card p-3">
                <Link href={`/posts/${p.id}`} className="underline">{p.text.slice(0, 100)}</Link>
                <p className="mt-1 text-xs text-muted">{p.error}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      <h2 className="mb-2 mt-8 text-sm font-medium text-muted">Recent activity</h2>
      <ul className="space-y-1 text-sm">
        {events.length ? events.map((e) => (
          <li key={e.id} className="text-muted"><span className="text-xs">{DateTime.fromJSDate(e.at, { zone: s.timezone }).toFormat("d LLL HH:mm")}</span> · {e.message}</li>
        )) : <li className="text-muted">Nothing yet. Once the scheduler runs, activity shows up here.</li>}
      </ul>
    </div>
  );
}
