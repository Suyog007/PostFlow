import { DateTime } from "luxon";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db, schema } from "./db/client";
import { uid } from "./context";
import type { Settings, Slot } from "./settings";

export interface SlotTime {
  platform: Slot["platform"];
  at: Date;
}

/** All slot instants (UTC dates) in [from, to], respecting the owner's timezone and DST. */
export function slotsBetween(settings: Pick<Settings, "slots" | "timezone">, from: Date, to: Date): SlotTime[] {
  const zone = settings.timezone;
  const out: SlotTime[] = [];
  const start = DateTime.fromJSDate(from, { zone }).startOf("day");
  const end = DateTime.fromJSDate(to, { zone }).endOf("day");
  for (let day = start; day <= end; day = day.plus({ days: 1 })) {
    for (const slot of settings.slots) {
      if (!slot.days.includes(day.weekday)) continue;
      const [h, m] = slot.time.split(":").map(Number);
      const at = day.set({ hour: h, minute: m, second: 0, millisecond: 0 });
      if (at.toMillis() < from.getTime() || at.toMillis() > to.getTime()) continue;
      out.push({ platform: slot.platform, at: at.toJSDate() });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function formatLocal(d: Date, zone: string) {
  return DateTime.fromJSDate(d, { zone }).toFormat("ccc d LLL, HH:mm");
}

/** Moves `at` to the end of the quiet window when it falls inside it (the window may wrap midnight). */
export function afterQuietHours(at: Date, zone: string, start: string, end: string): Date {
  const local = DateTime.fromJSDate(at, { zone });
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const now = local.hour * 60 + local.minute;
  const a = toMin(start);
  const b = toMin(end);
  if (a === b) return at;
  const inside = a < b ? now >= a && now < b : now >= a || now < b;
  if (!inside) return at;
  let out = local.set({ hour: Math.floor(b / 60), minute: b % 60, second: 0, millisecond: 0 });
  if (out <= local) out = out.plus({ days: 1 });
  return out.toJSDate();
}

/** The next configured slot for a platform that no live post uses (null if none in the next 14 days). */
export async function nextFreeSlot(settings: Pick<Settings, "slots" | "timezone">, platform: Slot["platform"], after: Date): Promise<Date | null> {
  const live = await db()
    .select({ at: schema.posts.scheduledAt })
    .from(schema.posts)
    .where(and(eq(schema.posts.userId, await uid()), eq(schema.posts.platform, platform), inArray(schema.posts.status, ["scheduled", "publishing", "published", "unconfirmed"]), gt(schema.posts.scheduledAt, after)));
  const taken = new Set(live.map((l) => l.at.getTime()));
  return slotsBetween(settings, after, new Date(after.getTime() + 14 * 86_400_000)).find((s) => s.platform === platform && !taken.has(s.at.getTime()))?.at ?? null;
}
