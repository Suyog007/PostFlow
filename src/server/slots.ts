import { DateTime } from "luxon";
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
