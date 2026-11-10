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
import { approvePostAction, connectAction, fillCalendarAction, rejectPostAction, togglePauseAction } from "@/app/actions";
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

  const focus = waiting[0];
  const rest = entries.filter((e) => e !== focus);
  const today = now.toFormat("cccc d LLLL");

  return (
    <div className="mx-auto max-w-[640px]">
      {(filling || firstRun) && <meta httpEquiv="refresh" content="30;url=/calendar" />}
      <Flash ok={sp.ok} error={sp.error} />

      <p className="text-[14px] text-[var(--muted)]">{today}</p>
      <h1 className="display mt-1 text-[32px] sm:text-[40px]">{focus ? `${waiting.length} ${waiting.length === 1 ? "post needs" : "posts need"} you` : "Your posts"}</h1>

      {/* The one thing to do now, big. */}
      <div className="mt-5">
        {s.paused ? (
          <Banner tone="warn" title="PostFlow is paused" body="Nothing is being written or posted until you turn it back on.">
            <form action={togglePauseAction}><input type="hidden" name="back" value="home" /><button className="btn btn-primary h-12 w-full px-6 text-[15px] sm:w-auto">Turn back on</button></form>
          </Banner>
        ) : !connected ? (
          <Banner tone="accent" title="Connect LinkedIn to start" body="PostFlow needs your LinkedIn account to post for you. It never posts without your OK.">
            <form action={connectAction}><input type="hidden" name="platform" value="linkedin" /><button className="btn btn-primary h-12 w-full px-6 text-[15px] sm:w-auto" disabled={!isPlatformConfigured("linkedin")}>Connect LinkedIn</button></form>
          </Banner>
        ) : firstRun ? (
          <Banner tone="calm" title="Writing your first posts" body="PostFlow is reading today's news in your field and picking the stories worth sharing. This takes 5 to 15 minutes. You can close this page." busy />
        ) : focus && !isOpen(focus) ? (
          <FocusCard p={focus} name={name} role={role} when={when(focus.scheduledAt)} thumb={thumbFor(focus)} more={waiting.length - 1} />
        ) : next ? (
          <Banner tone="good" title="You're all set" body={`Your next post goes out ${when(next.scheduledAt).replace(/^Today/, "today").replace(/^Tomorrow/, "tomorrow").replace(/^(\w+day) at/, "on $1 at")}. Nothing needs you right now.`} />
        ) : filling ? (
          <Banner tone="calm" title="Writing your next posts" body="Each one is researched and checked before it shows up here. This page updates by itself." busy />
        ) : (
          <Banner tone="calm" title="Looking for stories worth sharing" body="PostFlow checks the news all day and only writes when a story is worth your name.">
            <form action={fillCalendarAction}><button className="btn h-12 w-full px-6 text-[15px] sm:w-auto">Find stories now</button></form>
          </Banner>
        )}
      </div>

      {/* The week at a glance. */}
      <section className="mt-10" aria-label="This week">
        <h2 className="text-[17px] font-bold">This week</h2>
        <ol className="mt-3 grid grid-cols-7 gap-1.5">
          {days.map((d) => {
            const list = onDay(d);
            const isToday = d.hasSame(now, "day");
            return (
              <li key={d.toISODate()}>
                <a href={`#day-${d.toISODate()}`} className={`flex flex-col items-center rounded-[14px] py-2.5 transition-colors ${isToday ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "bg-[var(--surface)] hover:bg-[var(--raised)]"}`}>
                  <span className={`text-[11px] ${isToday ? "" : "text-[var(--muted)]"}`}>{d.toFormat("ccc")}</span>
                  <span className="text-[17px] font-bold tnum">{d.day}</span>
                  <span className="mt-1 flex h-1.5 gap-1" aria-label={`${list.length} ${list.length === 1 ? "post" : "posts"}`}>
                    {list.slice(0, 3).map((e) => (
                      <span key={e.id} className={`h-1.5 w-1.5 rounded-full ${isToday ? "bg-[var(--accent-ink)]" : isOpen(e) ? "bg-[var(--line-strong)]" : needsOk(e) ? "bg-[var(--warn)]" : "bg-[var(--good)]"}`} />
                    ))}
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Everything else coming up, one short row each. */}
      {rest.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[17px] font-bold">Coming up</h2>
          <div className="mt-3 space-y-5">
            {days.map((d) => {
              const list = onDay(d).filter((e) => e !== focus);
              if (!list.length) return null;
              return (
                <div key={d.toISODate()} id={`day-${d.toISODate()}`} className="scroll-mt-6">
                  <h3 className="mb-2 text-[13px] font-semibold text-[var(--muted)]">{dayTitle(d)}</h3>
                  <ul className="overflow-hidden rounded-[14px] bg-[var(--surface)]">
                    {list.map((e, i) => (
                      <li key={e.id} className={i ? "border-t border-[var(--line)]" : ""}>
                        <Row e={e} tz={tz} waiting={!isOpen(e) && needsOk(e)} approvalOn={approvalOn} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {!entries.length && !firstRun && connected && !s.paused && (
        <p className="mt-8 rounded-[14px] bg-[var(--surface)] px-5 py-8 text-center text-[15px] text-[var(--muted)]">No posts planned yet. New ones appear here as soon as they are written.</p>
      )}

      {posted.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-[15px] font-semibold text-[var(--muted)] hover:text-[var(--ink)]">Posted today ({posted.length})</summary>
          <ul className="mt-3 overflow-hidden rounded-[14px] bg-[var(--surface)]">
            {posted.map((p, i) => (
              <li key={p.id} className={i ? "border-t border-[var(--line)]" : ""}><Row e={p} tz={tz} waiting={false} approvalOn={approvalOn} /></li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-10 grid gap-2 sm:grid-cols-3">
        <Link href="/create" className="flex items-center gap-2 rounded-[14px] bg-[var(--surface)] px-4 py-3.5 text-[14px] font-medium hover:bg-[var(--raised)]"><Icon name="create" size={18} className="text-[var(--accent)]" />Write your own</Link>
        <Link href="/calendar?view=week" className="flex items-center gap-2 rounded-[14px] bg-[var(--surface)] px-4 py-3.5 text-[14px] font-medium hover:bg-[var(--raised)]"><Icon name="calendar" size={18} className="text-[var(--accent)]" />Full calendar</Link>
        <Link href="/settings?tab=times" className="flex items-center gap-2 rounded-[14px] bg-[var(--surface)] px-4 py-3.5 text-[14px] font-medium hover:bg-[var(--raised)]"><Icon name="clock" size={18} className="text-[var(--accent)]" />Posting times</Link>
      </div>
    </div>
  );
}

/** The post that needs you now, as it will look on LinkedIn, with the two answers. */
function FocusCard({ p, name, role, when, thumb, more }: { p: Post; name: string; role: string; when: string; thumb?: string; more: number }) {
  return (
    <article id={`post-${p.id}`} className="scroll-mt-24 rounded-[20px] bg-[var(--surface)] p-4 shadow-[0_12px_28px_-16px_rgba(0,0,0,.16)] sm:p-6">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-[var(--warn)]"><span className="h-2 w-2 rounded-full bg-[var(--warn)]" />Waiting for your OK · {when}</p>
      <div className="mt-4 overflow-hidden rounded-[14px] border border-[var(--line)]">
        <div className="flex items-center gap-3 px-4 pt-4">
          <Avatar name={name} size={40} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[14px] font-semibold">{name}</p>
            <p className="truncate text-[12px] text-[var(--muted)]">{role || "LinkedIn"}</p>
          </div>
          <PlatformGlyph platform={p.platform} size={18} />
        </div>
        <p className="post-text whitespace-pre-line break-words px-4 pb-4 pt-3 text-[15px] leading-[1.55]">{p.text}</p>
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element -- a signed, already-made picture
          <img src={thumb} alt="" aria-hidden="true" loading="lazy" className="block aspect-[16/9] w-full border-t border-[var(--line)] object-cover" />
        )}
      </div>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <form action={rejectPostAction} className="sm:mr-auto">
          <input type="hidden" name="id" value={p.id} />
          <button className="btn h-12 w-full px-5 text-[15px] sm:w-auto" title="Skip this one and write about a different story">Skip, try another story</button>
        </form>
        <Link href={`/posts/${p.id}`} className="btn h-12 px-5 text-[15px]"><Icon name="pencil" size={16} />Edit</Link>
        <form action={approvePostAction}>
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="back" value="home" />
          <button className="btn btn-primary h-12 w-full px-7 text-[15px] sm:w-auto"><Icon name="check" size={18} />Approve</button>
        </form>
      </div>
      {more > 0 && <p className="mt-3 text-center text-[13px] text-[var(--muted)] sm:text-right">{more} more after this one</p>}
    </article>
  );
}

/** One line in the list: time, the start of the post, and where it stands. */
function Row({ e, tz, waiting, approvalOn }: { e: Entry; tz: string; waiting: boolean; approvalOn: boolean }) {
  const time = DateTime.fromJSDate(e.scheduledAt, { zone: tz }).toFormat("h:mm a");
  if (isOpen(e))
    return (
      <div className="flex items-center gap-3 px-4 py-3.5 text-[14px] text-[var(--muted)]">
        <span className="w-[68px] flex-none text-[13px] tnum">{time}</span>
        <span className="min-w-0 flex-1">Finding a story for this time</span>
        <Icon name="clock" size={16} className="flex-none text-[var(--subtle)]" />
      </div>
    );
  const status =
    e.status === "published" ? { t: "Posted", c: "text-[var(--good)]" }
    : e.status === "failed" ? { t: "Could not post", c: "text-[var(--bad)]" }
    : e.status === "unconfirmed" ? { t: "Check this", c: "text-[var(--bad)]" }
    : waiting ? { t: "Needs OK", c: "text-[var(--warn)]" }
    : { t: approvalOn ? "Approved" : "Scheduled", c: "text-[var(--good)]" };
  return (
    <Link href={`/posts/${e.id}`} id={`post-${e.id}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[var(--raised)]">
      <span className="w-[68px] flex-none text-[13px] text-[var(--muted)] tnum">{time}</span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[14px] leading-snug">{e.text}</span>
        <span className={`mt-0.5 block text-[12px] font-semibold ${status.c}`}>{status.t}</span>
      </span>
      <Icon name="right" size={16} className="flex-none text-[var(--subtle)]" />
    </Link>
  );
}

function Banner({ tone, title, body, children, busy }: { tone: "warn" | "good" | "calm" | "accent"; title: string; body: string; children?: React.ReactNode; busy?: boolean }) {
  const dot = { warn: "bg-[var(--warn)]", good: "bg-[var(--good)]", calm: "bg-[var(--subtle)]", accent: "bg-[var(--accent)]" }[tone];
  return (
    <div className="flex flex-col gap-4 rounded-[20px] bg-[var(--surface)] p-5 shadow-[0_12px_28px_-16px_rgba(0,0,0,.16)] sm:flex-row sm:items-center sm:p-6" role="status">
      {busy ? <span aria-hidden="true" className="first-spinner flex-none" /> : <span aria-hidden="true" className={`h-3 w-3 flex-none rounded-full ${dot}`} />}
      <div className="min-w-0 flex-1">
        <p className="text-[18px] font-bold">{title}</p>
        <p className="mt-1 text-[15px] leading-relaxed text-[var(--muted)]">{body}</p>
      </div>
      {children}
    </div>
  );
}
