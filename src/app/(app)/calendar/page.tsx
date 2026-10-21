import Link from "next/link";
import { DateTime } from "luxon";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { getSettings } from "@/server/settings";
import { healthChecks } from "@/server/health";
import { recentEvents } from "@/server/events";
import { Icon, PageHeader, PlatformGlyph, StatusBadge } from "@/components/ui";
import { Flash } from "../flash";

type Post = typeof schema.posts.$inferSelect;

const HOUR_PX = 64;
const EVENT_MIN_PX = 54;

function Event({ p, tz, top, left, width, narrow, needsOk }: { p: Post; tz: string; top: number; left: number; width: number; narrow: boolean; needsOk: boolean }) {
  const t = DateTime.fromJSDate(p.scheduledAt, { zone: tz }).toFormat("HH:mm");
  const dead = p.status === "cancelled" || p.status === "expired";
  return (
    <Link
      href={`/posts/${p.id}`}
      className={`cal-event ${dead ? "opacity-55" : ""}`}
      style={{ top, left: `calc(${left}% + 2px)`, width: `calc(${width}% - 4px)`, height: EVENT_MIN_PX, borderLeftColor: p.platform === "x" ? "var(--x)" : "var(--li)" }}
      title={p.text}
    >
      <div className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
        <PlatformGlyph platform={p.platform} size={12} />
        <span className="mono">{t}</span>
        {p.fast && <Icon name="bolt" size={11} className="text-[var(--warn)]" />}
        {p.status === "published" && <Icon name="check" size={12} className="ml-auto text-[var(--good)]" />}
        {needsOk && <span className="ml-auto rounded bg-[var(--warn-soft)] px-1 text-[10px] font-medium text-[var(--warn)]" title="Needs your approval">Needs OK</span>}
        {(p.status === "failed" || p.status === "unconfirmed") && <Icon name="alert" size={12} className="ml-auto text-[var(--bad)]" />}
      </div>
      {!narrow && <div className={`line-clamp-2 break-words text-[12px] ${p.status === "cancelled" ? "line-through" : ""}`}>{p.text}</div>}
    </Link>
  );
}

/** Greedy lane assignment so posts at the same time sit side by side. */
function layoutDay(posts: Post[], tz: string, startHour: number) {
  const items = posts
    .map((p) => {
      const d = DateTime.fromJSDate(p.scheduledAt, { zone: tz });
      const minutes = d.hour * 60 + d.minute - startHour * 60;
      return { p, top: (minutes / 60) * HOUR_PX, lane: 0, lanes: 1, bottom: (minutes / 60) * HOUR_PX + EVENT_MIN_PX };
    })
    .sort((a, b) => a.top - b.top);
  let cluster: typeof items = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    cluster.forEach((c) => (c.lanes = lanes));
    cluster = [];
  };
  for (const it of items) {
    if (it.top >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => c.bottom > it.top).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    it.lane = lane;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.bottom);
  }
  flush();
  return items;
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ w?: string; ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const s = await getSettings();
  const needsOk = (p: Post) => s.requireApproval && p.status === "scheduled" && !p.approvedAt;
  const tz = s.timezone;
  const offset = Number(sp.w ?? 0) || 0;
  const weekStart = DateTime.now().setZone(tz).startOf("week").plus({ weeks: offset });
  const weekEnd = weekStart.plus({ weeks: 1 });

  const week = await db()
    .select()
    .from(schema.posts)
    .where(and(gte(schema.posts.scheduledAt, weekStart.toJSDate()), lt(schema.posts.scheduledAt, weekEnd.toJSDate()), inArray(schema.posts.status, ["scheduled", "publishing", "published", "unconfirmed", "failed", "cancelled", "expired"])))
    .orderBy(schema.posts.scheduledAt);
  const drafts = await db().select().from(schema.posts).where(eq(schema.posts.status, "draft")).orderBy(desc(schema.posts.createdAt)).limit(6);
  const held = (await db().select().from(schema.posts).where(and(eq(schema.posts.status, "rejected"), gte(schema.posts.createdAt, new Date(Date.now() - 3 * 86_400_000)))).orderBy(desc(schema.posts.createdAt)).limit(12)).filter((p) => p.text);
  const upcoming = await db().select().from(schema.posts).where(and(eq(schema.posts.status, "scheduled"), gte(schema.posts.scheduledAt, new Date()))).orderBy(schema.posts.scheduledAt).limit(1);
  const critical = (await healthChecks()).filter((c) => !c.ok && c.critical);
  const events = await recentEvents(10);

  const today = DateTime.now().setZone(tz);
  const hours = week.map((p) => DateTime.fromJSDate(p.scheduledAt, { zone: tz }).hour);
  const startHour = Math.min(7, ...hours);
  const endHour = Math.max(22, ...hours.map((h) => h + 1));
  const gridHeight = (endHour - startHour + 1) * HOUR_PX;
  const days = Array.from({ length: 7 }, (_, i) => weekStart.plus({ days: i }));
  const nowTop = ((today.hour * 60 + today.minute - startHour * 60) / 60) * HOUR_PX;
  const scheduledCount = week.filter((p) => p.status === "scheduled").length;
  const postedCount = week.filter((p) => p.status === "published").length;

  return (
    <div>
      <Flash ok={sp.ok} error={sp.error} />
      {critical.length > 0 && (
        <div className="mb-4 rounded-lg border border-[var(--warn)]/30 bg-[var(--warn-soft)] px-4 py-3 text-[13px]">
          <p className="mb-1 font-medium text-[var(--warn)]">Finish setup so autopilot can run</p>
          <ul className="list-disc space-y-0.5 pl-5 text-[var(--muted)]">
            {critical.map((c) => (
              <li key={c.label}><span className="font-medium text-[var(--ink)]">{c.label}.</span> {c.hint}</li>
            ))}
          </ul>
        </div>
      )}

      <PageHeader
        title={`${weekStart.toFormat("d LLL")} – ${weekEnd.minus({ days: 1 }).toFormat("d LLL yyyy")}`}
        description={
          upcoming[0] ? (
            <>Next up: <span className="inline-block align-[-1px]"><PlatformGlyph platform={upcoming[0].platform} size={12} /></span> {DateTime.fromJSDate(upcoming[0].scheduledAt, { zone: tz }).toFormat("ccc HH:mm")}. {scheduledCount} scheduled and {postedCount} posted this week. Everything scheduled goes out unless you remove it.</>
          ) : (
            <>Nothing scheduled yet. Autopilot fills open slots up to {s.horizonDays} days ahead.</>
          )
        }
        actions={
          <div className="flex items-center gap-1.5">
            <Link href={`/calendar?w=${offset - 1}`} className="btn btn-sm" aria-label="Previous week"><Icon name="left" size={14} /></Link>
            <Link href="/calendar" className="btn btn-sm">Today</Link>
            <Link href={`/calendar?w=${offset + 1}`} className="btn btn-sm" aria-label="Next week"><Icon name="right" size={14} /></Link>
            <Link href="/create" className="btn btn-primary btn-sm ml-1"><Icon name="create" size={14} />New post</Link>
          </div>
        }
      />

      {/* Desktop: time grid */}
      <div className="panel hidden overflow-hidden md:block">
        <div className="cal-grid border-b border-[var(--line)] bg-[var(--raised)]">
          <div />
          {days.map((d) => {
            const isToday = d.hasSame(today, "day");
            return (
              <div key={d.toISODate()} className="border-l border-[var(--line)] px-2 py-2 text-center">
                <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--subtle)]">{d.toFormat("ccc")}</div>
                <div className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-[14px] font-semibold tnum ${isToday ? "bg-[var(--ink)] text-[var(--bg)]" : ""}`}>{d.day}</div>
              </div>
            );
          })}
        </div>
        <div className="cal-grid" style={{ height: gridHeight }}>
          <div className="relative">
            {Array.from({ length: endHour - startHour + 1 }, (_, i) => (
              <div key={i} className="cal-hour -mt-px pr-2 text-right text-[11px] text-[var(--subtle)] mono" style={{ borderTop: "none", paddingTop: 0, transform: "translateY(-7px)" }}>
                {i === 0 ? "" : `${String(startHour + i).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const dayPosts = week.filter((p) => DateTime.fromJSDate(p.scheduledAt, { zone: tz }).hasSame(d, "day"));
            return (
              <div key={d.toISODate()} className="cal-col" style={{ height: gridHeight }}>
                {Array.from({ length: endHour - startHour + 1 }, (_, i) => <div key={i} className="cal-hour" />)}
                {layoutDay(dayPosts, tz, startHour).map((it) => (
                  <Event key={it.p.id} p={it.p} tz={tz} top={it.top} left={(it.lane / it.lanes) * 100} width={100 / it.lanes} narrow={it.lanes > 2} needsOk={needsOk(it.p)} />
                ))}
                {d.hasSame(today, "day") && nowTop > 0 && nowTop < gridHeight && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: nowTop }}>
                    <span className="-ml-1 h-2 w-2 rounded-full bg-[var(--bad)]" />
                    <span className="h-px flex-1 bg-[var(--bad)]" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: agenda */}
      <div className="space-y-4 md:hidden">
        {days.map((d) => {
          const dayPosts = week.filter((p) => DateTime.fromJSDate(p.scheduledAt, { zone: tz }).hasSame(d, "day"));
          return (
            <section key={d.toISODate()}>
              <h2 className={`mb-1.5 text-[12px] font-semibold uppercase tracking-wide ${d.hasSame(today, "day") ? "text-[var(--ink)]" : "text-[var(--subtle)]"}`}>{d.toFormat("cccc d LLL")}{d.hasSame(today, "day") ? " · Today" : ""}</h2>
              {dayPosts.length ? (
                <div className="panel divide">
                  {dayPosts.map((p) => (
                    <Link key={p.id} href={`/posts/${p.id}`} className="flex gap-3 px-3 py-2.5">
                      <div className="w-11 flex-none pt-0.5 text-[12px] text-[var(--muted)] mono">{DateTime.fromJSDate(p.scheduledAt, { zone: tz }).toFormat("HH:mm")}</div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex items-center gap-1.5"><PlatformGlyph platform={p.platform} size={13} />{p.fast && <Icon name="bolt" size={12} className="text-[var(--warn)]" />}<StatusBadge status={p.status} needsApproval={needsOk(p)} /></div>
                        <p className="line-clamp-2 break-words text-[13px]">{p.text}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-[var(--subtle)]">Nothing scheduled</p>
              )}
            </section>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="panel">
          <div className="panel-head"><Icon name="draft" size={15} />Drafts<span className="badge ml-1">{drafts.length}</span></div>
          {drafts.length ? (
            <div className="divide">
              {drafts.map((p) => (
                <Link key={p.id} href={`/posts/${p.id}`} className="flex gap-2.5 px-4 py-2.5 hover:bg-[var(--raised)]">
                  <PlatformGlyph platform={p.platform} size={14} />
                  <div className="min-w-0">
                    <p className="line-clamp-2 break-words text-[13px]">{p.text}</p>
                    {p.error && <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--warn)]">{p.error}</p>}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="px-4 py-6 text-[13px] text-[var(--subtle)]">No drafts. Posts you create as drafts, or that the reviewer held for you to look at, show up here.</p>
          )}
        </section>

        <section className="panel">
          <div className="panel-head"><Icon name="shield" size={15} />Held back by the reviewer<span className="badge ml-1">{held.length}</span></div>
          {held.length ? (
            <div className="divide max-h-[320px] overflow-auto">
              {held.map((p) => (
                <Link key={p.id} href={`/posts/${p.id}`} className="block px-4 py-2.5 hover:bg-[var(--raised)]">
                  <div className="flex items-center gap-1.5 text-[11px] text-[var(--subtle)]"><PlatformGlyph platform={p.platform} size={12} />{DateTime.fromJSDate(p.createdAt, { zone: tz }).toFormat("ccc HH:mm")}</div>
                  <p className="line-clamp-1 text-[13px]">{p.text}</p>
                  <p className="line-clamp-2 text-[12px] text-[var(--bad)]">{p.error?.replace(/^Reviewer: /, "")}</p>
                </Link>
              ))}
            </div>
          ) : (
            <p className="px-4 py-6 text-[13px] text-[var(--subtle)]">Nothing held back lately. Drafts the reviewer turns down appear here with the reason.</p>
          )}
        </section>

        <section className="panel lg:col-span-2">
          <div className="panel-head"><Icon name="clock" size={15} />Activity</div>
          <ul className="divide text-[13px]">
            {events.length ? events.map((e) => (
              <li key={e.id} className="flex gap-3 px-4 py-2">
                <span className="w-24 flex-none text-[12px] text-[var(--subtle)] mono">{DateTime.fromJSDate(e.at, { zone: tz }).toFormat("d LLL HH:mm")}</span>
                <span className="min-w-0 break-words">{e.message}</span>
              </li>
            )) : <li className="px-4 py-6 text-[var(--subtle)]">Nothing yet. Once the scheduler runs, what it does shows up here.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
