import { redirect } from "next/navigation";
import Link from "next/link";
import { DateTime } from "luxon";
import { and, count, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { needsWelcome } from "@/server/welcome";
import { db, schema } from "@/server/db/client";
import { getSettings } from "@/server/settings";
import { requireActiveUser } from "@/server/auth";
import { activePlatforms, approvalGate, entitlementOf } from "@/server/billing/plans";
import { Avatar, Icon, PlatformGlyph } from "@/components/ui";
import { Flash } from "../flash";
import { approvePostAction, connectAction, fillCalendarAction, rejectPostAction, togglePauseAction, unapprovePostAction } from "@/app/actions";
import { fillNowDays } from "@/server/generate";
import { slotsBetween } from "@/server/slots";
import { cardUrl, wantsImage } from "@/server/post-images";
import { isPlatformConfigured } from "@/server/platforms/accounts";
import { WeekView } from "./week";

type Post = typeof schema.posts.$inferSelect;
interface OpenSlot { open: true; id: string; platform: "x" | "linkedin"; scheduledAt: Date }
type Entry = Post | OpenSlot;
const isOpen = (e: Entry): e is OpenSlot => "open" in e;

type SP = { w?: string; ok?: string; error?: string; welcome?: string; view?: string };

export default async function HomePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (sp.view === "week") return <WeekView searchParams={Promise.resolve(sp)} />;

  const user = await requireActiveUser();
  const s = await getSettings();
  if (needsWelcome(s)) redirect("/welcome");
  const tz = s.timezone;
  const approvalOn = approvalGate(s, entitlementOf(user).features.autoMode).blocks;
  const needsOk = (p: Post) => approvalOn && p.status === "scheduled" && !p.approvedAt;
  const mine = eq(schema.posts.userId, user.id);

  const now = DateTime.now().setZone(tz);
  const start = now.startOf("day");
  const end = start.plus({ days: 7 });
  const week = await db()
    .select()
    .from(schema.posts)
    .where(and(mine, gte(schema.posts.scheduledAt, start.toJSDate()), lt(schema.posts.scheduledAt, end.toJSDate()), inArray(schema.posts.status, ["scheduled", "publishing", "published", "unconfirmed", "failed"])))
    .orderBy(schema.posts.scheduledAt);
  const withPicture = week.length
    ? new Set((await db().select({ id: schema.postImages.postId }).from(schema.postImages).where(inArray(schema.postImages.postId, week.map((p) => p.id)))).map((r) => r.id))
    : new Set<string>();
  const thumbFor = (p: Post) => (withPicture.has(p.id) && wantsImage(p, s) ? cardUrl(p) : undefined);

  const accounts = await db().select().from(schema.platformAccounts).where(eq(schema.platformAccounts.userId, user.id));
  const connected = accounts.some((a) => a.status === "connected");
  const active = await activePlatforms(user.id);
  const [{ n: everPosts }] = await db().select({ n: count() }).from(schema.posts).where(mine);
  const firstRun = Number(everPosts) === 0 && active.length > 0;
  const [lastFill] = await db().select().from(schema.events).where(and(eq(schema.events.userId, user.id), inArray(schema.events.kind, ["fill", "fill_done"]))).orderBy(desc(schema.events.at)).limit(1);
  const filling = lastFill?.kind === "fill" && Date.now() - lastFill.at.getTime() < 15 * 60_000;

  // Times in the next few days that have no post yet: shown as "PostFlow is finding a story".
  const taken = new Set(week.filter((p) => p.status !== "failed").map((p) => `${p.platform}@${p.scheduledAt.getTime()}`));
  const openFrom = new Date(Date.now() + 20 * 60_000);
  const openTo = new Date(Math.min(Date.now() + fillNowDays(s) * 86_400_000, end.toMillis() - 1));
  const open: OpenSlot[] = openFrom < openTo
    ? slotsBetween(s, openFrom, openTo).filter((sl) => active.includes(sl.platform) && !taken.has(`${sl.platform}@${sl.at.getTime()}`)).map((sl) => ({ open: true, id: `open-${sl.platform}-${sl.at.getTime()}`, platform: sl.platform, scheduledAt: sl.at }))
    : [];

  const upcoming = week.filter((p) => p.scheduledAt.getTime() > Date.now() - 5 * 60_000 || p.status === "publishing");
  const posted = week.filter((p) => p.status === "published" && !upcoming.includes(p));
  const entries: Entry[] = [...upcoming.filter((p) => p.status !== "published"), ...open].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  const waiting = entries.filter((e) => !isOpen(e) && needsOk(e));
  const next = entries.find((e) => !isOpen(e) && (e.approvedAt || !approvalOn));

  const name = s.profile.name || user.name || user.email;
  const role = s.profile.role;
  const when = (d: Date) => {
    const t = DateTime.fromJSDate(d, { zone: tz });
    const day = t.hasSame(now, "day") ? "Today" : t.hasSame(now.plus({ days: 1 }), "day") ? "Tomorrow" : t.toFormat("cccc");
    return `${day} at ${t.toFormat("h:mm a")}`;
  };
  const days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  const onDay = (d: DateTime) => entries.filter((e) => DateTime.fromJSDate(e.scheduledAt, { zone: tz }).hasSame(d, "day"));
  const dayTitle = (d: DateTime) => (d.hasSame(now, "day") ? "Today" : d.hasSame(now.plus({ days: 1 }), "day") ? "Tomorrow" : d.toFormat("cccc d LLLL"));

  return (
    <div className="mx-auto max-w-[680px]">
      {(filling || firstRun) && <meta httpEquiv="refresh" content="30;url=/calendar" />}
      <Flash ok={sp.ok} error={sp.error} />

      <h1 className="display text-[34px] leading-tight sm:text-[40px]">Your posts</h1>

      {/* One message, the most important one. */}
      <div className="mt-4">
        {s.paused ? (
          <Banner tone="warn" title="PostFlow is paused" body="Nothing is being written or posted until you turn it back on.">
            <form action={togglePauseAction}><input type="hidden" name="back" value="home" /><button className="btn btn-primary">Turn back on</button></form>
          </Banner>
        ) : !connected ? (
          <Banner tone="accent" title="Connect LinkedIn to get started" body="PostFlow needs your LinkedIn account to post for you. It never posts without your OK.">
            <form action={connectAction}><input type="hidden" name="platform" value="linkedin" /><button className="btn btn-primary" disabled={!isPlatformConfigured("linkedin")}>Connect LinkedIn</button></form>
          </Banner>
        ) : firstRun ? (
          <Banner tone="calm" title="Writing your first posts…" body="PostFlow is reading today's news in your field and picking the stories worth sharing. This takes 5 to 15 minutes. You can close this page." busy />
        ) : waiting.length ? (
          <Banner tone="warn" title={`${waiting.length} ${waiting.length === 1 ? "post is" : "posts are"} waiting for your OK`} body="Read them below and tap Approve. Posts you don't approve are skipped, never posted." />
        ) : next ? (
          <Banner tone="good" title="You're all set" body={`Your next post goes out ${when(next.scheduledAt).replace(/^Today/, "today").replace(/^Tomorrow/, "tomorrow").replace(/^(\w+day) at/, "on $1 at")}.`} />
        ) : filling ? (
          <Banner tone="calm" title="Writing your next posts…" body="Each one is researched and checked before it shows up here. This page updates by itself." busy />
        ) : (
          <Banner tone="calm" title="Looking for stories worth sharing" body="PostFlow checks the news every few minutes and only writes when a story is worth your name. Want one now?">
            <form action={fillCalendarAction}><button className="btn">Find stories now</button></form>
          </Banner>
        )}
      </div>

      {/* The week at a glance: one dot per post. */}
      <ol className="mt-6 grid grid-cols-7 gap-1.5" aria-label="This week">
        {days.map((d) => {
          const list = onDay(d);
          return (
            <li key={d.toISODate()}>
              <a href={`#day-${d.toISODate()}`} className={`flex flex-col items-center rounded-[10px] border py-2 transition-colors ${d.hasSame(now, "day") ? "border-[var(--ink)] bg-[var(--surface)]" : "border-[var(--line)] hover:border-[var(--line-strong)]"}`}>
                <span className="text-[11px] text-[var(--muted)]">{d.toFormat("ccc")}</span>
                <span className="text-[16px] font-semibold tnum">{d.day}</span>
                <span className="mt-1 flex h-2 gap-1" aria-label={`${list.length} ${list.length === 1 ? "post" : "posts"}`}>
                  {list.slice(0, 3).map((e) => (
                    <span key={e.id} className={`h-2 w-2 rounded-full ${isOpen(e) ? "border border-dashed border-[var(--subtle)]" : needsOk(e) ? "bg-[var(--warn)]" : "bg-[var(--good)]"}`} />
                  ))}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--muted)]">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--warn)]" />Needs your OK</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--good)]" />Ready</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-dashed border-[var(--subtle)]" />Being written</span>
      </p>

      {/* The posts themselves, day by day. */}
      <div className="mt-8 space-y-10">
        {days.map((d) => {
          const list = onDay(d);
          if (!list.length) return null;
          return (
            <section key={d.toISODate()} id={`day-${d.toISODate()}`} className="scroll-mt-6">
              <h2 className="mb-3 text-[15px] font-semibold">{dayTitle(d)}</h2>
              <div className="space-y-4">
                {list.map((e) =>
                  isOpen(e) ? (
                    <div key={e.id} className="flex items-center gap-3 rounded-[12px] border border-dashed border-[var(--line-strong)] px-4 py-4 text-[14px] text-[var(--muted)]">
                      <Icon name="clock" size={18} className="flex-none text-[var(--subtle)]" />
                      <span>PostFlow is finding a story for {DateTime.fromJSDate(e.scheduledAt, { zone: tz }).toFormat("h:mm a")}. Nothing to do.</span>
                    </div>
                  ) : (
                    <PostCard key={e.id} p={e} name={name} role={role} time={DateTime.fromJSDate(e.scheduledAt, { zone: tz }).toFormat("h:mm a")} waiting={needsOk(e)} approvalOn={approvalOn} thumb={thumbFor(e)} />
                  ),
                )}
              </div>
            </section>
          );
        })}
        {!entries.length && !firstRun && connected && (
          <p className="rounded-[12px] border border-dashed border-[var(--line-strong)] px-4 py-8 text-center text-[14px] text-[var(--muted)]">
            No posts planned yet. New ones appear here as soon as they are written.
          </p>
        )}
      </div>

      {posted.length > 0 && (
        <details className="mt-10">
          <summary className="cursor-pointer text-[14px] font-medium text-[var(--muted)] hover:text-[var(--ink)]">Posted earlier today ({posted.length})</summary>
          <div className="mt-3 space-y-4">
            {posted.map((p) => <PostCard key={p.id} p={p} name={name} role={role} time={DateTime.fromJSDate(p.scheduledAt, { zone: tz }).toFormat("h:mm a")} waiting={false} approvalOn={approvalOn} thumb={thumbFor(p)} />)}
          </div>
        </details>
      )}

      <div className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--line)] pt-5 text-[13px] text-[var(--muted)]">
        <Link href="/create" className="flex items-center gap-1.5 hover:text-[var(--ink)]"><Icon name="create" size={15} />Write your own post</Link>
        <Link href="/calendar?view=week" className="flex items-center gap-1.5 hover:text-[var(--ink)]"><Icon name="calendar" size={15} />Week view and history</Link>
        <Link href="/settings?tab=times" className="flex items-center gap-1.5 hover:text-[var(--ink)]"><Icon name="clock" size={15} />Change posting times</Link>
      </div>
    </div>
  );
}

function Banner({ tone, title, body, children, busy }: { tone: "warn" | "good" | "calm" | "accent"; title: string; body: string; children?: React.ReactNode; busy?: boolean }) {
  const dot = { warn: "bg-[var(--warn)]", good: "bg-[var(--good)]", calm: "bg-[var(--subtle)]", accent: "bg-[var(--accent)]" }[tone];
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-5" role="status">
      {busy ? <span aria-hidden="true" className="first-spinner flex-none" /> : <span aria-hidden="true" className={`h-3 w-3 flex-none rounded-full ${dot}`} />}
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[14px] text-[var(--muted)]">{body}</p>
      </div>
      {children}
    </div>
  );
}

/** A post as it will look on LinkedIn, with the one or two things you can do about it. */
function PostCard({ p, name, role, time, waiting, approvalOn, thumb }: { p: Post; name: string; role: string; time: string; waiting: boolean; approvalOn: boolean; thumb?: string }) {
  const long = p.text.length > 420;
  return (
    <article id={`post-${p.id}`} className={`scroll-mt-24 overflow-hidden rounded-[14px] border bg-[var(--surface)] ${waiting ? "border-[var(--warn)]/50" : "border-[var(--line)]"}`}>
      <div className="flex items-center gap-3 px-5 pt-4">
        <Avatar name={name} size={40} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[14px] font-semibold">{name}</p>
          <p className="truncate text-[12px] text-[var(--muted)]">{role || "LinkedIn"} · {time}</p>
        </div>
        <PlatformGlyph platform={p.platform} size={18} />
      </div>
      <Link href={`/posts/${p.id}`} className="block px-5 pb-4 pt-3">
        <p className={`post-text whitespace-pre-line break-words text-[15px] leading-[1.55] ${long ? "line-clamp-[8]" : ""}`}>{p.text}</p>
        {long && <span className="mt-1 inline-block text-[13px] text-[var(--muted)]">…see more</span>}
      </Link>
      {thumb && (
        // eslint-disable-next-line @next/next/no-img-element -- a signed, already-made picture
        <img src={thumb} alt="" aria-hidden="true" loading="lazy" className="block aspect-[16/9] w-full border-t border-[var(--line)] object-cover" />
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] bg-[var(--bg)] px-4 py-3">
        {p.status === "published" ? (
          <>
            <span className="flex items-center gap-1.5 text-[14px] font-medium text-[var(--good)]"><Icon name="check" size={16} />Posted</span>
            {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="btn btn-ghost ml-auto">See it on LinkedIn<Icon name="external" size={14} /></a>}
          </>
        ) : p.status === "failed" || p.status === "unconfirmed" ? (
          <>
            <span className="flex items-center gap-1.5 text-[14px] font-medium text-[var(--bad)]"><Icon name="alert" size={16} />{p.status === "failed" ? "Could not post" : "Not sure it posted"}</span>
            <Link href={`/posts/${p.id}`} className="btn ml-auto">See what happened</Link>
          </>
        ) : waiting ? (
          <>
            <form action={approvePostAction}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="back" value="home" />
              <button className="btn btn-primary h-10 px-5 text-[14px]"><Icon name="check" size={16} />Approve</button>
            </form>
            <Link href={`/posts/${p.id}`} className="btn h-10 px-4 text-[14px]"><Icon name="pencil" size={15} />Edit</Link>
            <form action={rejectPostAction} className="ml-auto">
              <input type="hidden" name="id" value={p.id} />
              <button className="btn btn-ghost h-10 text-[13px]" title="Skip this one and write about a different story">Different story</button>
            </form>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5 text-[14px] font-medium text-[var(--good)]"><Icon name="check" size={16} />{approvalOn ? "Approved" : "Scheduled"} · {time}</span>
            <span className="ml-auto flex items-center gap-1">
              <Link href={`/posts/${p.id}`} className="btn btn-ghost">Edit</Link>
              {approvalOn && p.approvedAt && (
                <form action={unapprovePostAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="back" value="home" />
                  <button className="btn btn-ghost">Undo</button>
                </form>
              )}
            </span>
          </>
        )}
      </div>
    </article>
  );
}
