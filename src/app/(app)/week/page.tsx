import Link from "next/link";
import { Icon } from "@/components/ui";
import { Flash } from "../flash";
import { loadWeek, dayLabel } from "../week-data";
import { WeekCard, WeekRows } from "../week-ui";

export default async function ThisWeekPage({ searchParams }: { searchParams: Promise<{ w?: string; ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const offset = Math.max(-8, Math.min(8, Number(sp.w ?? 0) || 0));
  const w = await loadWeek(offset);
  const end = w.start.plus({ days: 6 });
  const title = offset === 0 ? "This week" : offset === 1 ? "Next week" : offset === -1 ? "Last week" : `Week of ${w.start.toFormat("d LLLL")}`;
  return (
    <div className="mx-auto max-w-[760px]">
      <Flash ok={sp.ok} error={sp.error} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[16px] text-[var(--muted)]">{w.start.toFormat("d LLLL")} to {end.toFormat("d LLLL")}</p>
          <h1 className="display mt-1 text-[36px] leading-tight sm:text-[48px]">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/week?w=${offset - 1}`} className="btn h-11 w-11 p-0" aria-label="Previous week"><Icon name="left" size={18} /></Link>
          {offset !== 0 && <Link href="/week" className="btn h-11 px-4">This week</Link>}
          <Link href={`/week?w=${offset + 1}`} className="btn h-11 w-11 p-0" aria-label="Next week"><Icon name="right" size={18} /></Link>
        </div>
      </div>

      <div className="mt-6"><WeekCard w={w} /></div>

      <div className="mt-8 space-y-7">
        {w.days.map((d) => {
          const list = w.onDay(d);
          return (
            <section key={d.toISODate()} id={`day-${d.toISODate()}`} className="scroll-mt-24">
              <h2 className="mb-3 text-[17px] font-semibold">
                {dayLabel(d, w.now)} <span className="font-normal text-[var(--muted)]">{d.toFormat("d LLLL")}</span>
              </h2>
              {list.length ? <WeekRows w={w} list={list} /> : <p className="text-[15px] text-[var(--subtle)]">Nothing planned.</p>}
            </section>
          );
        })}
      </div>

      <p className="mt-10 flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--line)] pt-6 text-[15px]">
        <Link href="/settings/times" className="font-semibold text-[var(--accent)] hover:underline">Change when you post</Link>
        <Link href="/calendar?view=week" className="text-[var(--muted)] hover:text-[var(--ink)] hover:underline">Calendar grid and history</Link>
      </p>
    </div>
  );
}
