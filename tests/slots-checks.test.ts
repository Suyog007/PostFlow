import { describe, expect, it } from "vitest";
import { slotsBetween } from "../src/server/slots";
import { runChecks, weightedLength } from "../src/server/checks";

const settings = {
  timezone: "Asia/Kathmandu",
  slots: [
    { platform: "linkedin" as const, days: [1, 2, 3, 4, 5], time: "09:15" },
    { platform: "x" as const, days: [1, 2, 3, 4, 5, 6, 7], time: "19:30" },
  ],
};

describe("slots", () => {
  it("computes Kathmandu (UTC+5:45) slot instants", () => {
    // Mon 2026-10-19 00:00 UTC = 05:45 Kathmandu
    const slots = slotsBetween(settings, new Date("2026-10-19T00:00:00Z"), new Date("2026-10-19T23:59:00Z"));
    expect(slots.map((s) => [s.platform, s.at.toISOString()])).toEqual([
      ["linkedin", "2026-10-19T03:30:00.000Z"], // 09:15 NPT
      ["x", "2026-10-19T13:45:00.000Z"], // 19:30 NPT
    ]);
  });
  it("skips weekends for weekday-only slots", () => {
    const slots = slotsBetween(settings, new Date("2026-10-24T00:00:00Z"), new Date("2026-10-25T23:00:00Z")); // Sat-Sun
    expect(slots.every((s) => s.platform === "x")).toBe(true);
  });
  it("tracks DST in other zones", () => {
    const s = { ...settings, timezone: "America/New_York" };
    const li = (from: string, to: string) => slotsBetween(s, new Date(from), new Date(to)).find((y) => y.platform === "linkedin")!.at;
    expect(li("2026-10-30T00:00:00Z", "2026-10-30T23:00:00Z").getUTCHours()).toBe(13); // EDT: 09:15 -> 13:15Z
    expect(li("2026-11-02T00:00:00Z", "2026-11-02T23:00:00Z").getUTCHours()).toBe(14); // EST: 09:15 -> 14:15Z
  });
});

describe("checks", () => {
  it("counts URLs as 23 chars for X", () => {
    expect(weightedLength("hi https://example.com/a/very/long/path/that/goes/on/and/on")).toBe(3 + 23);
  });
  it("blocks X posts over 280", () => {
    expect(runChecks("a".repeat(281), "x").some((c) => c.code === "too_long" && c.severity === "block")).toBe(true);
  });
  it("flags slop phrases and blocks on two", () => {
    const one = runChecks("This is a game-changer for devs who ship code every single day of the week.", "x");
    expect(one.find((c) => c.code === "slop_phrases")?.severity).toBe("warn");
    const two = runChecks("A game-changer that will unlock the full potential of your team, honestly.", "x");
    expect(two.find((c) => c.code === "slop_phrases")?.severity).toBe("block");
  });
  it("blocks near-duplicates and question spam", () => {
    const t = "Postgres advisory locks are a cheap way to stop two workers from doing the same job twice.";
    expect(runChecks(t, "x", [t]).some((c) => c.code === "duplicate")).toBe(true);
    expect(runChecks("Why? How? When?", "x").some((c) => c.code === "questions")).toBe(true);
  });
});
