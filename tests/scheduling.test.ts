import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { checkSlot, isInWindow, suggestSlot, freshnessHorizon, type SlotContext } from "@/server/scheduling/rules";
import { defaultPreferences } from "@/server/preferences";

const KTM = "Asia/Kathmandu";
const at = (iso: string, zone = KTM) => DateTime.fromISO(iso, { zone }).toJSDate();

function ctx(overrides: Partial<SlotContext> = {}, platform: "x" | "linkedin" = "linkedin"): SlotContext {
  return { rules: defaultPreferences().platforms[platform], timezone: KTM, now: at("2026-10-12T08:00"), existing: [], ...overrides };
}

describe("timezone handling", () => {
  it("interprets windows in Asia/Kathmandu (UTC+05:45)", () => {
    const rules = defaultPreferences().platforms.linkedin; // Tue-Thu 09:00-11:00
    // Tuesday 2026-10-13 09:30 in Kathmandu is 03:45 UTC.
    const d = new Date("2026-10-13T03:45:00Z");
    expect(isInWindow(d, rules, KTM)).toBe(true);
    // Same instant is 05:45 in Berlin (CEST): the Kathmandu window still decides.
    expect(isInWindow(new Date("2026-10-13T02:59:00Z"), rules, KTM)).toBe(false);
  });

  it("suggests slots at local wall-clock times", () => {
    const s = suggestSlot(ctx(), "timely", null)!;
    const local = DateTime.fromJSDate(s.at, { zone: KTM });
    expect(local.toFormat("ccc HH:mm")).toBe("Tue 09:00");
    expect(s.at.toISOString()).toBe("2026-10-13T03:15:00.000Z");
  });

  it("handles DST: windows stay at local time across the change and skip nonexistent times", () => {
    const NY = "America/New_York";
    const rules = { ...defaultPreferences().platforms.x, minIntervalMinutes: 0, maxPerDay: 10, windows: [{ days: [7], start: "02:00", end: "04:00" }] };
    // 2027-03-14 is the US spring-forward Sunday: 02:00-02:59 does not exist.
    const s = suggestSlot({ rules, timezone: NY, now: DateTime.fromISO("2027-03-13T12:00", { zone: NY }).toJSDate(), existing: [] }, "timely", null)!;
    const local = DateTime.fromJSDate(s.at, { zone: NY });
    expect(local.toISODate()).toBe("2027-03-14");
    expect(local.hour).toBe(3);
    expect(local.offset).toBe(-240); // EDT after the change
  });
});

describe("platform rules", () => {
  it("blocks exceeding the daily limit and the minimum interval", () => {
    const rules = { ...defaultPreferences().platforms.x, maxPerDay: 2, minIntervalMinutes: 120 };
    const existing = [at("2026-10-12T09:00"), at("2026-10-12T19:00")];
    const v = checkSlot(at("2026-10-12T21:30"), { ...ctx({}, "x"), rules, existing });
    expect(v.map((x) => x.code)).toContain("max_per_day");
    expect(v.find((x) => x.code === "max_per_day")!.hard).toBe(true);
    const v2 = checkSlot(at("2026-10-13T10:00"), { ...ctx({}, "x"), rules, existing: [at("2026-10-13T09:00")] });
    expect(v2.map((x) => x.code)).toEqual(["min_interval"]);
  });

  it("warns (soft) outside windows and for stale time-sensitive posts", () => {
    const v = checkSlot(at("2026-10-12T23:00"), ctx(), { freshUntil: at("2026-10-12T20:00") });
    expect(v.map((x) => x.code).sort()).toEqual(["outside_window", "stale"]);
    expect(v.every((x) => !x.hard)).toBe(true);
  });

  it("weekly limit counts the user's local ISO week", () => {
    const rules = { ...defaultPreferences().platforms.linkedin, maxPerWeek: 3, minIntervalMinutes: 0, maxPerDay: 5 };
    const existing = [at("2026-10-13T09:00"), at("2026-10-14T09:00"), at("2026-10-15T09:00")];
    expect(checkSlot(at("2026-10-16T09:00"), { ...ctx(), rules, existing }).some((v) => v.code === "max_per_week")).toBe(true);
    // Next Monday is a new week.
    expect(checkSlot(at("2026-10-19T09:00"), { ...ctx(), rules, existing }).some((v) => v.code === "max_per_week")).toBe(false);
  });

  it("recommends publishing now when the next slot is after a story goes stale", () => {
    const s = suggestSlot(ctx(), "breaking", at("2026-10-12T12:00"))!;
    expect(s.reason).toMatch(/Consider publishing now/);
  });

  it("evergreen suggestions prefer an empty day", () => {
    const s = suggestSlot(ctx({ existing: [at("2026-10-13T10:00")] }), "evergreen", null)!;
    expect(DateTime.fromJSDate(s.at, { zone: KTM }).toFormat("ccc")).toBe("Wed");
    expect(s.reason).toMatch(/evergreen/);
  });

  it("freshness horizons", () => {
    const p = at("2026-10-12T08:00");
    expect(freshnessHorizon("evergreen", p, p)).toBeNull();
    expect(freshnessHorizon("breaking", p, p)!.getTime() - p.getTime()).toBe(36 * 3_600_000);
  });
});
