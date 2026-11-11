import Link from "next/link";
import type { ReactNode } from "react";
import { DateTime } from "luxon";
import { Avatar, Icon, PlatformGlyph } from "@/components/ui";
import { dayLabel, headline, type Post, type Week } from "./week-data";

/** The week at a glance: seven days, today ringed, a word under the days that have posts. */
export function WeekCard({ w, title }: { w: Week; title?: string }) {
  const total = w.posts.length;
  const waitingThisWeek = w.posts.filter(w.needsOk).length;
  return (
    <section className="rounded-[22px] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_16px_32px_-24px_rgba(27,36,32,.35)] sm:p-5" aria-label="This week">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="display text-[22px] sm:text-[24px]">{title ?? `${total} ${total === 1 ? "post" : "posts"} this week`}</h2>
        <p className="text-[15px] text-[var(--muted)]">
          {waitingThisWeek ? `${waitingThisWeek === 1 ? "One is" : waitingThisWeek === 2 ? "Two are" : `${waitingThisWeek} are`} waiting for you` : total ? "All set" : "Nothing yet"}
        </p>
      </div>
      <ol className="mt-4 grid grid-cols-7 gap-1">
        {w.days.map((d) => {
          const state = w.dayState(d);
          const today = d.hasSame(w.now, "day");
          const bg = state === "waiting" ? "bg-[var(--mark-soft)]" : state === "done" ? "bg-[var(--accent-soft)]" : today ? "bg-[var(--mark-soft)]/60" : "";
          const word = state === "waiting" ? "OK?" : state === "done" ? "Done" : today ? "Today" : "";
          return (
            <li key={d.toISODate()}>
              <a href={`/week#day-${d.toISODate()}`} className={`flex flex-col items-center rounded-[14px] px-0.5 py-2 ${bg}`}>
                <span className={`text-[12px] font-semibold uppercase tracking-[.04em] ${state === "done" ? "text-[var(--accent)]" : state === "waiting" || today ? "text-[var(--warn)]" : "text-[var(--muted)]"}`}>{d.toFormat("ccc")}</span>
                <span className={`mt-1 flex h-9 w-9 items-center justify-center rounded-full text-[18px] tnum ${today ? "border-[1.5px] border-[var(--ink)] font-semibold" : ""}`}>{d.day}</span>
                <span className={`mt-0.5 h-4 text-[12px] font-semibold ${state === "done" ? "text-[var(--accent)]" : "text-[var(--warn)]"}`}>{today && state !== "empty" ? "Today" : word}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A post as it will look on LinkedIn, with where the story came from. */
export function PostCard({ w, p }: { w: Week; p: Post }) {
  const src = w.sourceOf(p);
  const thumb = w.thumbFor(p);
  return (
    <article className="rounded-[22px] border border-[var(--line-strong)]/60 bg-[var(--surface)] p-5 shadow-[0_18px_36px_-26px_rgba(27,36,32,.45)] sm:p-6">
      <div className="flex items-center gap-3">
        <Avatar name={w.name} size={52} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[18px] font-semibold">{w.name}</p>
          <p className="truncate text-[14px] text-[var(--muted)]">{[w.role || "LinkedIn", "now"].join(" · ")}</p>
        </div>
        <PlatformGlyph platform={p.platform} size={26} />
      </div>
      <div className="post-text mt-4 space-y-3 whitespace-pre-line break-words text-[17px] leading-[1.6] sm:text-[18px]">{p.text}</div>
      {thumb && (
        // eslint-disable-next-line @next/next/no-img-element -- a signed, already-made picture
        <img src={thumb} alt="" aria-hidden="true" loading="lazy" className="mt-4 block aspect-[16/9] w-full rounded-[14px] border border-[var(--line)] object-cover" />
      )}
      {src && (
        <p className="mt-4 flex items-start gap-2.5 rounded-[14px] bg-[var(--raised)] px-4 py-3 text-[15px]">
          <Icon name="link" size={18} className="mt-0.5 flex-none text-[var(--accent)]" />
          <span>
            From the news:{" "}
            {src.url ? <a href={src.url} target="_blank" rel="noreferrer" className="font-semibold text-[var(--accent)] hover:underline">{src.name}</a> : <span className="font-semibold text-[var(--accent)]">{src.name}</span>}
          </span>
        </p>
      )}
    </article>
  );
}

/** One line per post: the day, a short headline, where it stands. */
export function WeekRows({ w, list, current }: { w: Week; list: Post[]; current?: string }) {
  return (
    <ul className="space-y-3">
      {list.map((p) => {
        const d = DateTime.fromJSDate(p.scheduledAt, { zone: w.tz });
        const waiting = w.needsOk(p);
        const label = dayLabel(d, w.now, true);
        const status =
          p.status === "published" ? "Posted"
          : p.status === "failed" ? "Could not post"
          : p.status === "unconfirmed" ? "Check this one"
          : waiting ? `Waiting for your OK${p.id === current ? " · this one" : ""}`
          : `${w.approvalOn ? "Approved" : "Scheduled"} · posts ${dayLabel(d, w.now).replace("Today", "today").replace("Tomorrow", "tomorrow")} ${d.hour < 12 ? "morning" : d.hour < 17 ? "afternoon" : "evening"}`;
        return (
          <li key={p.id}>
            <Link
              href={waiting ? `/calendar?post=${p.id}` : `/posts/${p.id}`}
              className={`grid grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-[18px] border bg-[var(--surface)] px-4 py-3.5 transition-colors hover:border-[var(--line-strong)] sm:grid-cols-[96px_minmax(0,1fr)] ${waiting ? "border-[var(--mark)]/70" : "border-[var(--line)]"}`}
            >
              <span className={`pt-0.5 text-[15px] font-semibold ${waiting ? "text-[var(--warn)]" : "text-[var(--accent)]"}`}>{label}</span>
              <span className="min-w-0">
                <span className="block text-[16px] leading-snug">{headline(p.text)}</span>
                <span className={`mt-1 block text-[14px] ${p.status === "failed" || p.status === "unconfirmed" ? "text-[var(--bad)]" : "text-[var(--muted)]"}`}>{status}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** A calm card for when there is nothing to answer: paused, not connected, writing, all set. */
export function StatusCard({ title, body, children, busy }: { title: string; body: string; children?: ReactNode; busy?: boolean }) {
  return (
    <div className="rounded-[22px] border border-[var(--line)] bg-[var(--surface)] p-6" role="status">
      <div className="flex items-start gap-3">
        {busy && <span aria-hidden="true" className="first-spinner mt-1 flex-none" />}
        <div>
          <p className="display text-[24px]">{title}</p>
          <p className="mt-2 max-w-[52ch] text-[16px] leading-relaxed text-[var(--muted)]">{body}</p>
        </div>
      </div>
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
