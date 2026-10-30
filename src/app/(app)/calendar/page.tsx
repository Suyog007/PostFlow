import { redirect } from "next/navigation";
import { needsWelcome } from "@/server/welcome";
import Link from "next/link";
import { DateTime } from "luxon";
import { and, count, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { getSettings } from "@/server/settings";
import { recentEvents } from "@/server/events";
import { requireActiveUser } from "@/server/auth";
import { activePlatforms, approvalGate, entitlementOf } from "@/server/billing/plans";
import { Icon, PageHeader, PlatformGlyph, StatusBadge } from "@/components/ui";
import { Flash } from "../flash";
import { fillCalendarAction, refreshQueuedAction, writeLessonAction } from "@/app/actions";
import { fillNowDays } from "@/server/generate";
import { slotsBetween } from "@/server/slots";
import { newsroomStatus } from "@/server/newsroom";
import { lastHeartbeat } from "@/server/health";
import { cardUrl, wantsImage } from "@/server/post-images";

type Post = typeof schema.posts.$inferSelect;
/** A slot in the planning window with nothing on it yet. */
interface OpenSlot { open: true; id: string; platform: "x" | "linkedin"; scheduledAt: Date }
type Entry = Post | OpenSlot;
const isOpen = (e: Entry): e is OpenSlot => "open" in e;

/** Each platform's own colour: a stripe on the left and a light wash behind the card. */
const platformTone = (platform: string) => (platform === "x" ? "var(--x)" : "var(--li)");
const platformWash = (platform: string) => `color-mix(in srgb, ${platformTone(platform)} 7%, var(--surface))`;

function Thumb({ src, size }: { src: string; size: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a signed, already-made picture; next/image would re-encode it
    <img src={src} alt="" aria-hidden="true" loading="lazy" width={size} height={size} className="flex-none rounded-[5px] border border-[var(--line)] object-cover" style={{ width: size, height: size }} />
  );
}

/** One short status per card, the same on phones and desktop. */
function CardBadge({ p, needsOk }: { p: Post; needsOk: boolean }) {
  if (needsOk) return <span className="badge badge-warn">Needs OK</span>;
  if (p.status === "published") return <span className="badge badge-good">Posted</span>;
  if (p.status === "scheduled") return p.approvedAt ? <span className="badge badge-good">Approved</span> : <span className="badge badge-info">Scheduled</span>;
  return <StatusBadge status={p.status} />;
}

/** A post in a day column: time, platform, status, the first lines and its picture. Full width, never squeezed. */
function DayCard({ p, tz, needsOk, thumb }: { p: Post; tz: string; needsOk: boolean; thumb?: string }) {
  const dead = p.status === "cancelled" || p.status === "expired";
  return (
    <Link
      href={`/posts/${p.id}`}
      title={p.text}
      className={`block rounded-[6px] border border-[var(--line)] border-l-[3px] p-2 transition-colors hover:border-[var(--line-strong)] ${dead ? "opacity-55" : ""}`}
      style={{ borderLeftColor: platformTone(p.platform), background: platformWash(p.platform) }}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
        <PlatformGlyph platform={p.platform} size={12} />
        <span className="mono">{DateTime.fromJSDate(p.scheduledAt, { zone: tz }).toFormat("HH:mm")}</span>
        {p.fast && <Icon name="bolt" size={11} className="text-[var(--warn)]" />}
        <span className="ml-auto"><CardBadge p={p} needsOk={needsOk} /></span>
      </div>
      <div className="mt-1.5 flex gap-2">
        <p className={`line-clamp-4 min-w-0 flex-1 break-words text-[12.5px] leading-snug ${p.status === "cancelled" ? "line-through" : ""}`}>{p.text}</p>
      </div>
      {thumb && (
        // eslint-disable-next-line @next/next/no-img-element -- a signed, already-made picture; next/image would re-encode it
        <img src={thumb} alt="" aria-hidden="true" loading="lazy" className="mt-2 aspect-[16/9] w-full rounded-[4px] border border-[var(--line)] object-cover" />
      )}
    </Link>
  );
}

/** The calendar's first-run loader: shown until the account's very first posts are written. */
function FirstRun({ mins }: { mins: number }) {
  const late = mins >= 25;
  const steps = ["Reading the news in your field", "Picking the stories worth posting", "Writing and fact-checking each post"];
  return (
    <section className="panel mb-5 p-5" role="status" aria-live="polite">
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className="first-spinner mt-1 flex-none" />
        <div className="min-w-0">
          <h2 className="display text-[24px]">{late ? "Still looking for the right stories." : "Writing your first posts…"}</h2>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--muted)]">
            {late
              ? "It is a quiet news day in your field, so nothing has cleared the bar yet. PostFlow keeps looking every few minutes; you can add a note about your own work, or add a source in Settings, to get a first post sooner."
              : "This usually takes 5 to 15 minutes: every post is researched, written and checked twice before it lands here. You can close this page; we'll message you on Telegram if it's linked."}
          </p>
          {!late && (
            <ol className="mt-4 space-y-2 text-[13px]">
              {steps.map((t, n) => (
                <li key={t} className="first-step flex items-center gap-2.5" style={{ animationDelay: `${n * 1.6}s` }}>
                  <span aria-hidden="true" className="first-dot" />
                  {t}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

function OpenCard({ e, tz, loading }: { e: OpenSlot; tz: string; loading?: boolean }) {
  if (loading)
    return (
      <div className="first-skeleton rounded-[6px] border border-[var(--line)] p-2 text-[11px] text-[var(--subtle)]">
        <div className="flex items-center gap-1.5"><PlatformGlyph platform={e.platform} size={12} /><span className="mono">{DateTime.fromJSDate(e.scheduledAt, { zone: tz }).toFormat("HH:mm")}</span></div>
        <span aria-hidden="true" className="mt-2 block h-2 w-11/12 rounded bg-[var(--line)]" />
        <span aria-hidden="true" className="mt-1.5 block h-2 w-2/3 rounded bg-[var(--line)]" />
        <span className="sr-only">Writing a post for this slot</span>
      </div>
    );
  return (
    <div className="rounded-[6px] border border-dashed border-[var(--line-strong)] p-2 text-[11px] text-[var(--subtle)]" title="Open slot: PostFlow fills it automatically when a story worth posting comes in. You don\u2019t need to do anything.">
      <div className="flex items-center gap-1.5"><PlatformGlyph platform={e.platform} size={12} /><span className="mono">{DateTime.fromJSDate(e.scheduledAt, { zone: tz }).toFormat("HH:mm")}</span></div>
      <p className="mt-1">Open · fills by itself</p>
    </div>
  );
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ w?: string; ok?: string; error?: string; welcome?: string }> }) {
  const sp = await searchParams;
  const user = await requireActiveUser();
  const s = await getSettings();
  if (needsWelcome(s)) redirect("/welcome");
  const approvalOn = approvalGate(s, entitlementOf(user).features.autoMode).blocks;
  const needsOk = (p: Post) => approvalOn && p.status === "scheduled" && !p.approvedAt;
  const mine = eq(schema.posts.userId, user.id);
  const tz = s.timezone;
  const offset = Number(sp.w ?? 0) || 0;
  // A rolling 7 days starting today, so the next few days (and what "Fill now" wrote) are always on screen.
  const weekStart = DateTime.now().setZone(tz).startOf("day").plus({ weeks: offset });
  const weekEnd = weekStart.plus({ weeks: 1 });

  const week = await db()
    .select()
    .from(schema.posts)
    .where(and(mine, gte(schema.posts.scheduledAt, weekStart.toJSDate()), lt(schema.posts.scheduledAt, weekEnd.toJSDate()), inArray(schema.posts.status, ["scheduled", "publishing", "published", "unconfirmed", "failed", "cancelled", "expired"])))
    .orderBy(schema.posts.scheduledAt);
  // Thumbnails only for pictures that already exist: opening the calendar never makes new ones.
  const withPicture = week.length
    ? new Set((await db().select({ id: schema.postImages.postId }).from(schema.postImages).where(inArray(schema.postImages.postId, week.map((p) => p.id)))).map((r) => r.id))
    : new Set<string>();
  const drafts = await db().select().from(schema.posts).where(and(mine, eq(schema.posts.status, "draft"))).orderBy(desc(schema.posts.createdAt)).limit(6);
  const held = (await db().select().from(schema.posts).where(and(mine, eq(schema.posts.status, "rejected"), gte(schema.posts.createdAt, new Date(Date.now() - 3 * 86_400_000)))).orderBy(desc(schema.posts.createdAt)).limit(12)).filter((p) => p.text);
  const upcoming = await db().select().from(schema.posts).where(and(mine, eq(schema.posts.status, "scheduled"), gte(schema.posts.scheduledAt, new Date()))).orderBy(schema.posts.scheduledAt).limit(1);
  // Getting started: what a new account still has to do before autopilot can write good posts.
  const accounts = await db().select().from(schema.platformAccounts).where(eq(schema.platformAccounts.userId, user.id));
  const [{ n: noteCount }] = await db().select({ n: count() }).from(schema.notes).where(eq(schema.notes.userId, user.id));
  const steps = [
    { done: accounts.some((a) => a.status === "connected"), label: "Connect LinkedIn or X", hint: "So posts can be published for you.", href: "/settings#accounts" },
    { done: !!(s.profile.role || s.profile.expertise.length), label: "Tell PostFlow who you are", hint: "Your role, what you know well, and how you sound.", href: "/settings#profile" },
    { done: Number(noteCount) > 0, label: "Add a note (optional)", hint: "News posts need nothing from you. Posts about your own work come only from notes.", href: "/notes" },
    { done: !!user.telegramChatId, label: "Link Telegram (optional)", hint: "Approve posts and send notes from your phone.", href: "/settings#telegram" },
  ];
  const showSteps = steps.slice(0, 2).some((x) => !x.done) || (!!sp.welcome && steps.some((x) => !x.done));
  const events = await recentEvents(10);
  const [lastFill] = await db().select().from(schema.events).where(and(eq(schema.events.userId, user.id), inArray(schema.events.kind, ["fill", "fill_done"]))).orderBy(desc(schema.events.at)).limit(1);
  const filling = lastFill?.kind === "fill" && Date.now() - lastFill.at.getTime() < 15 * 60_000;

  const today = DateTime.now().setZone(tz);
  const days = Array.from({ length: 7 }, (_, i) => weekStart.plus({ days: i }));
  const active = await activePlatforms(user.id);
  const scheduledCount = week.filter((p) => p.status === "scheduled").length;
  // Open slots in the "Fill now" window, so an empty day reads as "being filled", not "broken".
  const liveKeys = new Set(week.filter((p) => ["scheduled", "publishing", "published", "unconfirmed"].includes(p.status)).map((p) => `${p.platform}@${p.scheduledAt.getTime()}`));
  const openFrom = new Date(Math.max(Date.now() + 20 * 60_000, weekStart.toMillis()));
  const openTo = new Date(Math.min(Date.now() + fillNowDays(s) * 86_400_000, weekEnd.toMillis() - 1));
  const openSlots: OpenSlot[] = openFrom < openTo
    ? slotsBetween(s, openFrom, openTo).filter((sl) => active.includes(sl.platform) && !liveKeys.has(`${sl.platform}@${sl.at.getTime()}`)).map((sl) => ({ open: true, id: `open-${sl.platform}-${sl.at.getTime()}`, platform: sl.platform, scheduledAt: sl.at }))
    : [];
  // First run: an account with a connected platform and no posts at all yet. The calendar shows a loader
  // and refreshes itself until the first posts arrive.
  const [{ n: everPosts }] = await db().select({ n: count() }).from(schema.posts).where(mine);
  const connectedAt = accounts.filter((x) => x.status === "connected").map((x) => x.updatedAt.getTime()).sort()[0] ?? null;
  const firstRun = Number(everPosts) === 0 && active.length > 0 && offset === 0;
  const firstRunMins = connectedAt ? Math.round((Date.now() - connectedAt) / 60_000) : 0;
  // Shown while slots are open, so an empty calendar reads as "being worked on", not "waiting for you".
  const status = !firstRun && !filling && openSlots.length && offset >= 0 ? await newsroomStatus(user.id, s, { beat: await lastHeartbeat() }) : null;
  const entries: Entry[] = [...week, ...openSlots].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  const postedCount = week.filter((p) => p.status === "published").length;
  const thumbFor = (p: Post) => (withPicture.has(p.id) && wantsImage(p, s) ? cardUrl(p) : undefined);

  return (
    <div>
      {/* While "Fill now" runs, reload every 20 s so new posts show up without a manual refresh. */}
      {filling && <meta httpEquiv="refresh" content={`20;url=/calendar${offset ? `?w=${offset}` : ""}`} />}
      {firstRun && !filling && <meta httpEquiv="refresh" content="30;url=/calendar" />}
      {firstRun && <FirstRun mins={firstRunMins} />}
      {!filling && <Flash ok={sp.ok} error={sp.error} />}
      {filling && !firstRun && (
        <div className="panel mb-4 flex items-center gap-2 px-4 py-3 text-[13px]" role="status">
          {/* Pulses only while a fill is running, and only for people who have not asked for reduced motion. */}
          <span className="h-2 w-2 rounded-full bg-[var(--warn)] motion-safe:animate-pulse" />
          Filling the next {fillNowDays(s)} days. Each post is written and reviewed, so this takes a few minutes. This page refreshes by itself.
        </div>
      )}
      {status && (
        <div className="panel mb-4 flex items-start gap-3 px-4 py-3 text-[13px]" role="status">
          <span
            aria-hidden="true"
            className={`mt-1.5 h-2 w-2 flex-none rounded-full ${status.state === "working" || status.state === "starting" ? "bg-[var(--good)] motion-safe:animate-pulse" : status.state === "paused" || status.state === "resting" ? "bg-[var(--warn)]" : "bg-[var(--bad)]"}`}
          />
          <div>
            <p className="font-semibold">{status.headline}</p>
            <p className="mt-0.5 text-[var(--muted)]">{status.detail}</p>
          </div>
        </div>
      )}
      {showSteps && (
        <section className="panel mb-5 p-4" aria-label="Getting started">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-semibold">{sp.welcome ? "Welcome to PostFlow. Connect an account and autopilot takes over." : "Finish setting up"}</h2>
            <span className="text-[12px] text-[var(--subtle)]">{steps.filter((x) => x.done).length} of {steps.length} done</span>
          </div>
          <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((st, i) => (
              <li key={st.label}>
                <Link href={st.href} className={`flex h-full gap-3 rounded-lg border p-3 ${st.done ? "border-[var(--line)] opacity-60" : "border-[var(--line-strong)] hover:border-[var(--ink)]"}`}>
                  <span className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[12px] font-semibold ${st.done ? "bg-[var(--good-soft)] text-[var(--good)]" : "bg-[var(--ink)] text-[var(--bg)]"}`}>
                    {st.done ? <Icon name="check" size={13} /> : i + 1}
                  </span>
                  <span>
                    <span className={`block text-[13px] font-medium ${st.done ? "line-through" : ""}`}>{st.label}</span>
                    <span className="block text-[12px] text-[var(--muted)]">{st.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <PageHeader
        title={`${offset === 0 ? "This week" : offset === 1 ? "Next week" : offset === -1 ? "Last week" : "Week"} · ${weekStart.toFormat("d LLL")} – ${weekEnd.minus({ days: 1 }).toFormat("d LLL")}`}
        description={
          upcoming[0] ? (
            <>Next up: <span className="inline-block align-[-1px]"><PlatformGlyph platform={upcoming[0].platform} size={12} /></span> {DateTime.fromJSDate(upcoming[0].scheduledAt, { zone: tz }).toFormat("ccc HH:mm")}. {scheduledCount} scheduled and {postedCount} posted in these 7 days. {approvalOn ? "Posts go out only once you approve them; the rest are skipped." : "Everything scheduled goes out unless you remove it."}</>
          ) : (
            <>Nothing scheduled yet. PostFlow fills the open slots below by itself, up to {s.horizonDays} days ahead.</>
          )
        }
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={`/calendar?w=${offset - 1}`} className="btn btn-sm" aria-label="Previous week"><Icon name="left" size={14} /></Link>
            <Link href="/calendar" className="btn btn-sm" aria-current={offset === 0 ? "page" : undefined}>This week</Link>
            <Link href={`/calendar?w=${offset + 1}`} className="btn btn-sm" aria-label="Next week"><Icon name="right" size={14} /></Link>
            <form action={refreshQueuedAction} className="ml-1">
              <button className="btn btn-sm" title="Write every queued post you have not approved again, in the latest style"><Icon name="repost" size={14} />Rewrite queued</button>
            </form>
            <form action={writeLessonAction}>
              <button className="btn btn-sm" title="Write a short, simple lesson for your audience in the next free slot"><Icon name="notes" size={14} />Add a lesson</button>
            </form>
            <form action={fillCalendarAction}>
              <button className="btn btn-sm" disabled={filling} title={`Write posts now for every open slot in the next ${fillNowDays(s)} days, retrying slots that failed`}>
                <Icon name="bolt" size={14} />{filling ? "Filling…" : "Fill now"}
              </button>
            </form>
            <Link href="/create" className="btn btn-primary btn-sm ml-1"><Icon name="create" size={14} />New post</Link>
          </div>
        }
      />

      {/* Desktop: one column per day, posts in time order. */}
      <div className="panel hidden overflow-hidden md:grid md:grid-cols-7">
        {days.map((d, i) => {
          const isToday = d.hasSame(today, "day");
          const dayPosts = entries.filter((p) => DateTime.fromJSDate(p.scheduledAt, { zone: tz }).hasSame(d, "day"));
          return (
            <section key={d.toISODate()} aria-label={d.toFormat("cccc d LLL")} className={`flex min-h-[420px] min-w-0 flex-col ${i ? "border-l border-[var(--line)]" : ""} ${isToday ? "bg-[var(--mark-soft)]/40" : ""}`}>
              <header className="flex items-baseline justify-between gap-1 border-b border-[var(--line)] px-2.5 py-2">
                <span className={`text-[11px] font-semibold uppercase tracking-wide ${isToday ? "text-[var(--ink)]" : "text-[var(--subtle)]"}`}>{isToday ? "Today" : d.toFormat("ccc")}</span>
                <span className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-[14px] font-semibold tnum ${isToday ? "bg-[var(--mark)] text-[var(--mark-ink)]" : ""}`}>{d.day}</span>
              </header>
              <div className="flex flex-1 flex-col gap-2 p-2">
                {dayPosts.length ? dayPosts.map((p) => (isOpen(p) ? <OpenCard key={p.id} e={p} tz={tz} loading={firstRun} /> : <DayCard key={p.id} p={p} tz={tz} needsOk={needsOk(p)} thumb={thumbFor(p)} />)) : <p className="px-1 pt-1 text-[12px] text-[var(--subtle)]">Nothing planned</p>}
              </div>
            </section>
          );
        })}
      </div>

      {/* Mobile: agenda */}
      <div className="space-y-4 md:hidden">
        {days.map((d) => {
          const dayPosts = entries.filter((p) => DateTime.fromJSDate(p.scheduledAt, { zone: tz }).hasSame(d, "day"));
          return (
            <section key={d.toISODate()}>
              <h2 className={`mb-1.5 text-[12px] font-semibold uppercase tracking-wide ${d.hasSame(today, "day") ? "text-[var(--ink)]" : "text-[var(--subtle)]"}`}>{d.toFormat("cccc d LLL")}{d.hasSame(today, "day") ? " · Today" : ""}</h2>
              {dayPosts.length ? (
                <div className="panel divide">
                  {dayPosts.map((p) => isOpen(p) ? (
                    <div key={p.id} className="flex gap-3 px-3 py-2.5 text-[var(--subtle)]">
                      <div className="w-11 flex-none pt-0.5 text-[12px] mono">{DateTime.fromJSDate(p.scheduledAt, { zone: tz }).toFormat("HH:mm")}</div>
                      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]"><PlatformGlyph platform={p.platform} size={13} />{firstRun ? "Writing a post for this slot…" : "Open slot · fills by itself"}</div>
                    </div>
                  ) : (
                    <Link key={p.id} href={`/posts/${p.id}`} className="flex gap-3 border-l-[3px] px-3 py-2.5" style={{ borderLeftColor: platformTone(p.platform), background: platformWash(p.platform) }}>
                      <div className="w-11 flex-none pt-0.5 text-[12px] text-[var(--muted)] mono">{DateTime.fromJSDate(p.scheduledAt, { zone: tz }).toFormat("HH:mm")}</div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex items-center gap-1.5"><PlatformGlyph platform={p.platform} size={13} />{p.fast && <Icon name="bolt" size={12} className="text-[var(--warn)]" />}<CardBadge p={p} needsOk={needsOk(p)} /></div>
                        <p className="line-clamp-2 break-words text-[13px]">{p.text}</p>
                      </div>
                      {thumbFor(p) && <Thumb src={thumbFor(p)!} size={52} />}
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
