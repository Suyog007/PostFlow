import Link from "next/link";
import { clsx } from "clsx";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireUser } from "@/server/auth";
import { getUserPreferences, type Preferences } from "@/server/preferences";
import { calendarRange, draftsWithCurrent, type CalendarEntry } from "@/server/queries";
import { Empty, PageHeader, PlatformBadge, Section, StatusBadge } from "@/components/ui";
import { firstLine, fmtDateTime } from "@/lib/format";

type View = "week" | "month" | "list";
type StatusFilter = "all" | "scheduled" | "published" | "problems";

const STATUS_STATES: Record<StatusFilter, string[] | null> = {
  all: null,
  scheduled: ["scheduled", "publishing", "needs_review", "unknown"],
  published: ["published"],
  problems: ["failed", "needs_review", "unknown"],
};

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const userId = await requireUser();
  const prefs = await getUserPreferences(userId);
  const tz = prefs.timezone;
  const sp = await searchParams;
  const view: View = sp.view === "month" || sp.view === "list" ? sp.view : "week";
  const platform = sp.platform === "x" || sp.platform === "linkedin" ? sp.platform : null;
  const status: StatusFilter = (["scheduled", "published", "problems"] as const).find((s) => s === sp.status) ?? "all";
  const anchor = (sp.date ? DateTime.fromISO(sp.date, { zone: tz }) : DateTime.now().setZone(tz)).startOf("day");
  const today = DateTime.now().setZone(tz).startOf("day");

  let from: DateTime, to: DateTime;
  if (view === "week") {
    // Rolling seven days from the anchor (today by default), so "this week" never hides tomorrow.
    from = anchor;
    to = from.plus({ days: 7 });
  } else if (view === "month") {
    from = anchor.startOf("month").startOf("week");
    to = anchor.endOf("month").endOf("week").plus({ milliseconds: 1 });
  } else {
    from = today;
    to = today.plus({ days: 60 });
  }

  const raw = await calendarRange(userId, from.toJSDate(), to.toJSDate());
  const entries = raw.filter((e) => (!platform || e.platform === platform) && (!STATUS_STATES[status] || STATUS_STATES[status]!.includes(e.state)));
  const pending = (await draftsWithCurrent(userId, ["approved", "awaiting_approval"])).filter((d) => !platform || d.platform === platform);

  const q = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { view, platform, status: status === "all" ? null : status, date: sp.date ?? null, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/calendar?${p.toString()}`;
  };
  const step = view === "month" ? { months: 1 } : { weeks: 1 };
  const title =
    view === "week" ? `${from.toFormat("d LLL")} – ${to.minus({ days: 1 }).toFormat("d LLL yyyy")}` : view === "month" ? anchor.toFormat("LLLL yyyy") : "Next 60 days";

  return (
    <div>
      <PageHeader title="Calendar" subtitle={`All times in ${tz}.`} />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Seg items={[["week", "Week"], ["month", "Month"], ["list", "List"]]} active={view} href={(k) => q({ view: k })} />
        <Seg items={[["", "Both"], ["linkedin", "LinkedIn"], ["x", "X"]]} active={platform ?? ""} href={(k) => q({ platform: k || null })} />
        <Seg items={[["all", "All"], ["scheduled", "Scheduled"], ["published", "Published"], ["problems", "Problems"]]} active={status} href={(k) => q({ status: k === "all" ? null : k })} />
        {view !== "list" && (
          <div className="ml-auto flex items-center gap-1">
            <Link className="btn-ghost px-2" href={q({ date: anchor.minus(step).toISODate() })} aria-label="Previous">
              <ChevronLeft size={16} />
            </Link>
            <Link className="btn-secondary" href={q({ date: null })}>
              Today
            </Link>
            <Link className="btn-ghost px-2" href={q({ date: anchor.plus(step).toISODate() })} aria-label="Next">
              <ChevronRight size={16} />
            </Link>
            <span className="ml-2 text-sm font-medium">{title}</span>
          </div>
        )}
      </div>

      <div className="space-y-8">
        <div className="min-w-0">
          {view === "week" && <Week from={from} entries={entries} tz={tz} prefs={prefs} platform={platform} today={today} />}
          {view === "month" && <Month from={from} to={to} anchor={anchor} entries={entries} tz={tz} today={today} />}
          {view === "list" && <ListView entries={entries} tz={tz} />}
        </div>
        <aside className="grid gap-6 md:grid-cols-2">
          <Section title={`Approved, not scheduled (${pending.filter((d) => d.status === "approved").length})`}>
            <PendingList rows={pending.filter((d) => d.status === "approved")} empty="None." />
          </Section>
          <Section title={`Awaiting approval (${pending.filter((d) => d.status === "awaiting_approval").length})`}>
            <PendingList rows={pending.filter((d) => d.status === "awaiting_approval")} empty="Nothing waiting." />
          </Section>
        </aside>
      </div>
    </div>
  );
}

function Seg({ items, active, href }: { items: [string, string][]; active: string; href: (k: string) => string }) {
  return (
    <div className="flex gap-1 rounded-lg border border-line bg-card p-1 text-sm">
      {items.map(([k, l]) => (
        <Link key={k} href={href(k)} className={clsx("rounded-md px-2.5 py-1", active === k ? "bg-accent-soft text-accent" : "text-muted hover:text-ink")}>
          {l}
        </Link>
      ))}
    </div>
  );
}

function EntryCard({ e, tz, compact }: { e: CalendarEntry; tz: string; compact?: boolean }) {
  const problem = ["failed", "needs_review", "unknown"].includes(e.state);
  return (
    <Link
      href={`/drafts/${e.draftId}`}
      className={clsx(
        "block rounded-lg border p-2 text-xs transition hover:shadow-sm",
        e.platform === "x" ? "border-l-4 border-l-x" : "border-l-4 border-l-li",
        problem ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30" : e.state === "published" ? "border-line bg-paper opacity-80" : "border-line bg-card",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-semibold">{fmtDateTime(e.when, tz, "h:mm a")}</span>
        <PlatformBadge platform={e.platform} />
      </div>
      {!compact && <div className="mt-1 line-clamp-2 text-[13px] leading-snug">{firstLine(e.parts, 100)}</div>}
      {!compact && (
        <div className="mt-1">
          <StatusBadge status={e.state} />
        </div>
      )}
    </Link>
  );
}

function windowsFor(prefs: Preferences, weekday: number, platform: string | null) {
  return (["linkedin", "x"] as const)
    .filter((p) => !platform || p === platform)
    .flatMap((p) => prefs.platforms[p].windows.filter((w) => w.days.includes(weekday)).map((w) => ({ p, text: `${w.start}–${w.end}`, paused: prefs.platforms[p].paused })));
}

function Week({ from, entries, tz, prefs, platform, today }: { from: DateTime; entries: CalendarEntry[]; tz: string; prefs: Preferences; platform: string | null; today: DateTime }) {
  const days = Array.from({ length: 7 }, (_, i) => from.plus({ days: i }));
  return (
    <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
      {days.map((d) => {
        const list = entries.filter((e) => DateTime.fromJSDate(e.when, { zone: tz }).hasSame(d, "day"));
        const wins = windowsFor(prefs, d.weekday, platform);
        const isToday = d.hasSame(today, "day");
        return (
          <div key={d.toISODate()} className={clsx("card min-h-56 p-2", isToday && "ring-2 ring-accent/40")}>
            <div className="mb-2 flex items-baseline justify-between">
              <span className={clsx("text-sm font-semibold", isToday && "text-accent")}>{d.toFormat("ccc d")}</span>
              <span className="text-xs text-muted">{list.length || ""}</span>
            </div>
            <div className="mb-2 flex flex-wrap gap-1">
              {wins.map((w, i) => (
                <span key={i} className={clsx("whitespace-nowrap rounded px-1 text-[10px]", w.paused ? "bg-paper text-muted line-through" : "bg-paper text-muted")} title={`${w.p === "x" ? "X" : "LinkedIn"} posting window`}>
                  {w.p === "x" ? "X" : "in"} {w.text}
                </span>
              ))}
            </div>
            <div className="space-y-1.5">
              {list.map((e) => (
                <EntryCard key={e.id} e={e} tz={tz} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Month({ from, to, anchor, entries, tz, today }: { from: DateTime; to: DateTime; anchor: DateTime; entries: CalendarEntry[]; tz: string; today: DateTime }) {
  const days: DateTime[] = [];
  for (let d = from; d < to; d = d.plus({ days: 1 })) days.push(d);
  return (
    <div>
      <div className="mb-1 hidden grid-cols-7 gap-1 text-center text-xs text-muted md:grid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 md:grid-cols-7">
        {days.map((d) => {
          const list = entries.filter((e) => DateTime.fromJSDate(e.when, { zone: tz }).hasSame(d, "day"));
          return (
            <div key={d.toISODate()} className={clsx("card min-h-24 p-1.5", !d.hasSame(anchor, "month") && "opacity-40", d.hasSame(today, "day") && "ring-2 ring-accent/40")}>
              <div className="mb-1 text-xs font-medium">{d.toFormat("d")}</div>
              <div className="space-y-1">
                {list.slice(0, 4).map((e) => (
                  <EntryCard key={e.id} e={e} tz={tz} compact />
                ))}
                {list.length > 4 && <div className="text-[10px] text-muted">+{list.length - 4} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListView({ entries, tz }: { entries: CalendarEntry[]; tz: string }) {
  if (!entries.length) return <Empty>Nothing scheduled in the next 60 days.</Empty>;
  const byDay = new Map<string, CalendarEntry[]>();
  for (const e of entries) {
    const k = DateTime.fromJSDate(e.when, { zone: tz }).toISODate()!;
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  return (
    <div className="space-y-5">
      {[...byDay.entries()].map(([day, list]) => (
        <div key={day}>
          <h3 className="mb-2 text-sm font-semibold">{DateTime.fromISO(day, { zone: tz }).toFormat("cccc, d LLLL")}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {list.map((e) => (
              <EntryCard key={e.id} e={e} tz={tz} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PendingList({ rows, empty }: { rows: Awaited<ReturnType<typeof draftsWithCurrent>>; empty: string }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="card divide-y divide-line">
      {rows.slice(0, 12).map((d) => (
        <li key={d.id}>
          <Link href={`/drafts/${d.id}`} className="block p-2.5 text-sm hover:bg-paper">
            <PlatformBadge platform={d.platform} /> <span className="ml-1">{firstLine(d.revision?.parts, 60)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
