import { DateTime } from "luxon";
import type { PlatformRules } from "../preferences";

export type Timeliness = "breaking" | "timely" | "evergreen";

export interface SlotContext {
  rules: PlatformRules;
  timezone: string;
  now: Date;
  /** Times of other live (scheduled/publishing/published) posts on the same platform. */
  existing: Date[];
}

export interface Violation {
  code: "max_per_day" | "max_per_week" | "min_interval" | "outside_window" | "in_past" | "stale" | "paused";
  message: string;
  /** Hard violations block scheduling; soft ones are shown as warnings. */
  hard: boolean;
}

const MIN_LEAD_MINUTES = 2;

function local(d: Date, tz: string) {
  return DateTime.fromJSDate(d, { zone: tz });
}

/** ISO week key in the user's timezone, e.g. "2026-W41". */
function weekKey(d: Date, tz: string) {
  const l = local(d, tz);
  return `${l.weekYear}-W${l.weekNumber}`;
}

function dayKey(d: Date, tz: string) {
  return local(d, tz).toISODate();
}

function minutesOfDay(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function isInWindow(at: Date, rules: PlatformRules, tz: string): boolean {
  const l = local(at, tz);
  const mins = l.hour * 60 + l.minute;
  return rules.windows.some(
    (w) => w.days.includes(l.weekday) && mins >= minutesOfDay(w.start) && mins < minutesOfDay(w.end),
  );
}

/**
 * Deterministic check of a proposed publication time against the platform's rules.
 * The user stays in control: soft violations are warnings, hard ones block.
 */
export function checkSlot(
  at: Date,
  ctx: SlotContext,
  opts: { freshUntil?: Date | null; publishNow?: boolean } = {},
): Violation[] {
  const { rules, timezone: tz, now, existing } = ctx;
  const out: Violation[] = [];

  if (rules.paused) {
    out.push({ code: "paused", hard: false, message: "Publishing is paused for this platform. It will not go out until you resume." });
  }
  if (!opts.publishNow && at.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60_000 - 1000) {
    out.push({ code: "in_past", hard: true, message: "That time is in the past. Pick a future time or publish now." });
  }

  const sameDay = existing.filter((e) => dayKey(e, tz) === dayKey(at, tz)).length;
  if (sameDay >= rules.maxPerDay) {
    out.push({
      code: "max_per_day",
      hard: true,
      message: `Daily limit reached (${rules.maxPerDay} per day on ${local(at, tz).toFormat("ccc d LLL")}).`,
    });
  }
  const sameWeek = existing.filter((e) => weekKey(e, tz) === weekKey(at, tz)).length;
  if (sameWeek >= rules.maxPerWeek) {
    out.push({ code: "max_per_week", hard: true, message: `Weekly limit reached (${rules.maxPerWeek} per week).` });
  }
  if (rules.minIntervalMinutes > 0) {
    const tooClose = existing.find((e) => Math.abs(e.getTime() - at.getTime()) < rules.minIntervalMinutes * 60_000);
    if (tooClose) {
      out.push({
        code: "min_interval",
        hard: true,
        message: `Another post is at ${local(tooClose, tz).toFormat("ccc d LLL, HH:mm")}; minimum gap is ${formatMinutes(rules.minIntervalMinutes)}.`,
      });
    }
  }
  if (!opts.publishNow && !isInWindow(at, rules, tz)) {
    out.push({ code: "outside_window", hard: false, message: "Outside your preferred posting windows." });
  }
  if (opts.freshUntil && at.getTime() > opts.freshUntil.getTime()) {
    out.push({
      code: "stale",
      hard: false,
      message: `This is time-sensitive and will likely be stale after ${local(opts.freshUntil, tz).toFormat("ccc d LLL, HH:mm")}.`,
    });
  }
  return out;
}

export interface Suggestion {
  at: Date;
  reason: string;
}

/**
 * Suggest the next available slot. Pure and deterministic.
 * - breaking/timely: earliest valid slot; if that is after the freshness horizon, recommend publishing now.
 * - evergreen: the earliest slot on the least-busy day within the next week, to fill quiet periods.
 */
export function suggestSlot(
  ctx: SlotContext,
  timeliness: Timeliness,
  freshUntil: Date | null,
  horizonDays = 14,
): Suggestion | null {
  const { rules, timezone: tz, now } = ctx;
  const candidates: Date[] = [];
  const start = local(now, tz).startOf("day");

  for (let d = 0; d < horizonDays; d++) {
    const day = start.plus({ days: d });
    for (const w of rules.windows) {
      if (!w.days.includes(day.weekday)) continue;
      for (let m = minutesOfDay(w.start); m < minutesOfDay(w.end); m += 30) {
        const t = day.set({ hour: Math.floor(m / 60), minute: m % 60, second: 0, millisecond: 0 });
        // Skip wall-clock times that do not exist (DST gap): luxon shifts them forward.
        if (t.hour * 60 + t.minute !== m) continue;
        const at = t.toJSDate();
        if (checkSlot(at, ctx, { freshUntil: null }).some((v) => v.hard)) continue;
        candidates.push(at);
      }
    }
  }
  candidates.sort((a, b) => a.getTime() - b.getTime());
  if (candidates.length === 0) return null;

  const fmt = (d: Date) => local(d, tz).toFormat("cccc d LLL 'at' h:mm a");

  if (timeliness !== "evergreen") {
    const first = candidates[0];
    if (freshUntil && first.getTime() > freshUntil.getTime()) {
      return {
        at: first,
        reason: `This story is time-sensitive and your next open slot (${fmt(first)}) is after it likely goes stale. Consider publishing now instead.`,
      };
    }
    const label = timeliness === "breaking" ? "This is breaking news" : "This is timely";
    return { at: first, reason: `${label}, so the earliest open slot in your posting windows is suggested: ${fmt(first)}.` };
  }

  // Evergreen: spread out. Count posts per local day and pick the least busy day within a week.
  const counts = new Map<string, number>();
  for (const e of ctx.existing) counts.set(dayKey(e, tz)!, (counts.get(dayKey(e, tz)!) ?? 0) + 1);
  const weekAhead = candidates.filter((c) => c.getTime() < now.getTime() + 7 * 86_400_000);
  const pool = weekAhead.length ? weekAhead : candidates;
  let best = pool[0];
  for (const c of pool) {
    if ((counts.get(dayKey(c, tz)!) ?? 0) < (counts.get(dayKey(best, tz)!) ?? 0)) best = c;
  }
  const busy = counts.get(dayKey(best, tz)!) ?? 0;
  return {
    at: best,
    reason:
      busy === 0
        ? `Suggested for ${fmt(best)}: this is an evergreen post and your queue is empty that day.`
        : `Suggested for ${fmt(best)}: this is evergreen and that is your least busy day this week.`,
  };
}

/** How long a post stays fresh, from the underlying item's publication time. */
export function freshnessHorizon(timeliness: Timeliness, publishedAt: Date | null, now: Date): Date | null {
  const base = publishedAt ?? now;
  if (timeliness === "breaking") return new Date(base.getTime() + 36 * 3_600_000);
  if (timeliness === "timely") return new Date(base.getTime() + 5 * 86_400_000);
  return null;
}

function formatMinutes(m: number) {
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? "" : "s"}`;
  if (m % 60 === 0) return `${m / 60}h`;
  return `${m} min`;
}
