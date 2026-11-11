import { redirect } from "next/navigation";
import Link from "next/link";
import { DateTime } from "luxon";
import { needsWelcome } from "@/server/welcome";
import { isPlatformConfigured } from "@/server/platforms/accounts";
import { Icon } from "@/components/ui";
import { Flash } from "../flash";
import { approvePostAction, connectAction, fillCalendarAction, rejectPostAction, togglePauseAction, unapprovePostAction } from "@/app/actions";
import { loadWeek, dayLabel } from "../week-data";
import { PostCard, StatusCard, WeekCard, WeekRows } from "../week-ui";
import { WeekView } from "./week";

type SP = { w?: string; ok?: string; error?: string; welcome?: string; view?: string; post?: string };

function firstName(name: string) {
  const words = name.split(/\s+/).filter((x) => !/^(dr|mr|mrs|ms|prof)\.?$/i.test(x));
  return words[0]?.includes("@") ? "" : (words[0] ?? "");
}

export default async function HomePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (sp.view === "week") return <WeekView searchParams={Promise.resolve(sp)} />;

  const w = await loadWeek();
  if (needsWelcome(w.s)) redirect("/welcome");
  const hour = w.now.hour;
  const hello = `Good ${hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}${firstName(w.name) ? `, ${firstName(w.name)}` : ""}`;
  const index = Math.max(0, w.waiting.findIndex((p) => p.id === sp.post));
  const focus = w.waiting[index];
  const when = (d: Date) => {
    const t = DateTime.fromJSDate(d, { zone: w.tz });
    const day = dayLabel(t, w.now);
    return `${day === "Today" || day === "Tomorrow" ? day.toLowerCase() : `on ${day}`} at ${t.toFormat("h:mm a")}`;
  };

  const main = w.s.paused ? (
    <StatusCard title="PostFlow is paused" body="Nothing is written or posted while it is paused. Your settings and posts are kept.">
      <form action={togglePauseAction}><input type="hidden" name="back" value="home" /><button className="btn btn-primary h-14 w-full text-[17px] sm:w-auto sm:px-8">Turn it back on</button></form>
    </StatusCard>
  ) : !w.connected ? (
    <StatusCard title="Connect your LinkedIn" body="PostFlow needs your LinkedIn account to post for you. It never posts anything you have not approved.">
      <form action={connectAction}><input type="hidden" name="platform" value="linkedin" /><button className="btn btn-primary h-14 w-full text-[17px] sm:w-auto sm:px-8" disabled={!isPlatformConfigured("linkedin")}>Connect LinkedIn</button></form>
    </StatusCard>
  ) : w.firstRun ? (
    <StatusCard busy title="Writing your first posts" body="PostFlow is reading today's news in your field and picking what is worth sharing. This takes 5 to 15 minutes. You can close this page; they will be waiting here." />
  ) : focus ? null : w.nextUp ? (
    <StatusCard title="Nothing needs you right now" body={`Your next post goes out ${when(w.nextUp.scheduledAt)}. New posts will show up here for your OK.`}>
      <div className="flex flex-wrap gap-2">
        <Link href={`/posts/${w.nextUp.id}`} className="btn h-12 px-6 text-[16px]">See it</Link>
        {w.approvalOn && w.nextUp.approvedAt && (
          <form action={unapprovePostAction}><input type="hidden" name="id" value={w.nextUp.id} /><input type="hidden" name="back" value="home" /><button className="btn btn-ghost h-12 px-5 text-[16px]">Undo approval</button></form>
        )}
      </div>
    </StatusCard>
  ) : w.filling ? (
    <StatusCard busy title="Writing your next posts" body="Each one is researched and checked before it shows up here. This page updates by itself." />
  ) : (
    <StatusCard title="Looking for news worth sharing" body="PostFlow checks the news in your field all day and only writes when a story is worth your name.">
      <form action={fillCalendarAction}><button className="btn h-12 px-6 text-[16px]">Look for stories now</button></form>
    </StatusCard>
  );

  return (
    <div>
      {(w.filling || w.firstRun) && <meta httpEquiv="refresh" content="30;url=/calendar" />}
      <Flash ok={sp.ok} error={sp.error} />
      <p className="text-[16px] text-[var(--muted)]">{w.now.toFormat("cccc d LLLL")}</p>
      <h1 className="display mt-1 text-[36px] leading-tight sm:text-[52px]">{hello}</h1>

      <div className="mt-6 grid gap-6 lg:mt-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
        {/* Right on wide screens, first on phones: the week. */}
        <aside className="space-y-4 lg:order-2 lg:pt-14">
          <WeekCard w={w} />
          {w.posts.length > 0 && (
            <div className="hidden lg:block">
              <WeekRows w={w} list={w.posts} current={focus?.id} />
            </div>
          )}
        </aside>

        <section className="lg:order-1">
          {main ?? (
            <>
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 rounded-full bg-[var(--mark-soft)] px-4 py-2 text-[16px] font-semibold text-[var(--warn)]">
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--warn)]" />Waiting for you
                </span>
                <span className="flex items-center gap-1 text-[16px] text-[var(--muted)]">
                  {index > 0 && <Link href={`/calendar?post=${w.waiting[index - 1].id}`} aria-label="Previous post" className="rounded-full p-1.5 hover:bg-[var(--raised)]"><Icon name="left" size={18} /></Link>}
                  Post <strong className="font-semibold text-[var(--ink)]">{index + 1} of {w.waiting.length}</strong>
                  {index < w.waiting.length - 1 && <Link href={`/calendar?post=${w.waiting[index + 1].id}`} aria-label="Next post" className="rounded-full p-1.5 hover:bg-[var(--raised)]"><Icon name="right" size={18} /></Link>}
                </span>
              </div>
              <p className="mb-3 text-[15px] text-[var(--muted)]">Goes out {when(focus!.scheduledAt)} once you approve it.</p>
              <div id={`post-${focus!.id}`} className="scroll-mt-24"><PostCard w={w} p={focus!} /></div>

              {/* The answers. On phones they stay above the tab bar while you read. */}
              <div className="sticky bottom-[76px] z-20 -mx-4 mt-4 bg-gradient-to-t from-[var(--bg)] from-70% px-4 pb-3 pt-4 md:static md:mx-0 md:bg-none md:p-0 lg:max-w-[640px]">
                <form action={approvePostAction}>
                  <input type="hidden" name="id" value={focus!.id} />
                  <input type="hidden" name="back" value="home" />
                  <button className="btn btn-primary h-14 w-full text-[18px]"><Icon name="check" size={20} />Approve</button>
                </form>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Link href={`/posts/${focus!.id}`} className="btn h-14 text-[17px]">Change</Link>
                  <form action={rejectPostAction}>
                    <input type="hidden" name="id" value={focus!.id} />
                    <button className="btn h-14 w-full text-[17px]" title="Skip this one. PostFlow writes about a different story instead.">Skip</button>
                  </form>
                </div>
              </div>
            </>
          )}

          <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-[16px]">
            <Link href="/create" className="inline-flex items-center gap-2 font-semibold text-[var(--accent)] hover:underline"><Icon name="create" size={18} />Write your own post</Link>
            <Link href="/notes" className="inline-flex items-center gap-2 font-semibold text-[var(--accent)] hover:underline"><Icon name="notes" size={18} />Tell PostFlow about your work</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
