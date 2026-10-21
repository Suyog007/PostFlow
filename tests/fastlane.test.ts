import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { fillCalendar } from "../src/server/generate";
import { saveSettings } from "../src/server/settings";
import { afterQuietHours } from "../src/server/slots";
import { GOOD_REVIEW, fakeLLM, resetDb, me } from "./helpers";

const NOW = new Date("2026-10-21T03:00:00Z"); // 08:45 Kathmandu
const EVENING_SLOT = [{ platform: "x" as const, days: [1, 2, 3, 4, 5, 6, 7], time: "19:30" }];

const POSTS = [
  "WhatsApp opened its API to free agent messaging, according to the announcement. I'd expect a wave of small business agents to follow. Worth prototyping one this week.",
  "Cloud vendor cut GPU prices by half, per their blog. That looks like a window for solo builders to ship fine-tuned niche models.",
  "A payments regulator in Nepal published new API rules, per Techpana. Gaps in tooling usually mean room for a small dev product.",
];

async function addItem(title: string, over: Partial<typeof schema.items.$inferInsert> = {}) {
  const [it] = await db()
    .insert(schema.items)
    .values({ userId: me(), url: `https://example.com/${encodeURIComponent(title)}`, title, summary: `${title}: enough summary text to write about it.`, pillar: "news", publishedAt: new Date(NOW.getTime() - 2 * 3_600_000), relevance: 9, urgency: "breaking", analyzedAt: NOW, ...over })
      .returning();
  return it;
}

function llm() {
  let n = 0;
  fakeLLM((req) => (req.schemaName === "write_post" ? { text: POSTS[n++ % POSTS.length] } : GOOD_REVIEW));
}

describe("fast lane", () => {
  beforeEach(async () => {
    await resetDb();
    await saveSettings({ slots: EVENING_SLOT, horizonDays: 1, pillars: { own_work: 0, news: 1, local: 0, learning: 0 }, fastLane: { enabled: true, minRelevance: 9, maxPerDay: 1, leadMinutes: 45, platforms: ["x"], quietStart: "23:00", quietEnd: "07:00" } });
  });

  it("schedules an extra post about 45 minutes out, outside the normal slots", async () => {
    const item = await addItem("WhatsApp API is free now");
    llm();
    await fillCalendar({ now: NOW, max: 1 });
    const [p] = await db().select().from(schema.posts).where(eq(schema.posts.fast, true));
    expect(p).toMatchObject({ status: "scheduled", platform: "x", itemId: item.id });
    expect(p.scheduledAt.toISOString()).toBe("2026-10-21T03:45:00.000Z"); // 09:30 NPT is not a normal slot (only 19:30)
    expect(p.expiresAt).toBeTruthy();
  });

  it("needs a high score, breaking urgency and a fresh story", async () => {
    await addItem("Score eight", { relevance: 8 });
    await addItem("Weekly story", { urgency: "week" });
    await addItem("Old story", { publishedAt: new Date(NOW.getTime() - 13 * 3_600_000) });
    llm();
    await fillCalendar({ now: NOW, max: 1 });
    expect(await db().select().from(schema.posts).where(eq(schema.posts.fast, true))).toHaveLength(0);
  });

  it("respects the daily limit", async () => {
    await addItem("First big story");
    await addItem("Second big story");
    llm();
    await fillCalendar({ now: NOW, max: 1 });
    await fillCalendar({ now: new Date(NOW.getTime() + 600_000), max: 1 });
    expect(await db().select().from(schema.posts).where(eq(schema.posts.fast, true))).toHaveLength(1);
  });

  it("does nothing when switched off", async () => {
    await saveSettings({ fastLane: { enabled: false, minRelevance: 9, maxPerDay: 1, leadMinutes: 45, platforms: ["x"], quietStart: "23:00", quietEnd: "07:00" } });
    await addItem("Big story");
    llm();
    await fillCalendar({ now: NOW, max: 1 });
    expect(await db().select().from(schema.posts).where(eq(schema.posts.fast, true))).toHaveLength(0);
  });

  it("waits out quiet hours", async () => {
    const lateNow = new Date("2026-10-21T16:45:00Z"); // 22:30 NPT; +45m = 23:15 NPT, inside quiet hours
    await addItem("Late breaking story that builders care about", { publishedAt: new Date(lateNow.getTime() - 3_600_000) });
    llm();
    await fillCalendar({ now: lateNow, max: 1 });
    const [p] = await db().select().from(schema.posts).where(eq(schema.posts.fast, true));
    expect(p.scheduledAt.toISOString()).toBe("2026-10-22T01:15:00.000Z"); // 07:00 NPT
  });

  it("does not use up the normal time-sensitive allowance", async () => {
    await saveSettings({ slots: [{ platform: "x", days: [1, 2, 3, 4, 5, 6, 7], time: "12:30" }] });
    await addItem("Fast story one");
    await addItem("Normal slot story");
    llm();
    await fillCalendar({ now: NOW, max: 2 });
    const rows = await db().select().from(schema.posts).where(eq(schema.posts.status, "scheduled"));
    expect(rows.filter((r) => r.fast)).toHaveLength(1);
    expect(rows.filter((r) => !r.fast && r.expiresAt)).toHaveLength(1);
  });
});

describe("afterQuietHours", () => {
  const z = "Asia/Kathmandu";
  it("leaves times outside the window alone", () => {
    const at = new Date("2026-10-21T06:00:00Z"); // 11:45
    expect(afterQuietHours(at, z, "23:00", "07:00")).toBe(at);
  });
  it("moves late-night times to the morning, across midnight", () => {
    expect(afterQuietHours(new Date("2026-10-21T17:30:00Z"), z, "23:00", "07:00").toISOString()).toBe("2026-10-22T01:15:00.000Z"); // 23:15 -> 07:00 next day
  });
  it("moves early-morning times to the same morning", () => {
    expect(afterQuietHours(new Date("2026-10-21T21:00:00Z"), z, "23:00", "07:00").toISOString()).toBe("2026-10-22T01:15:00.000Z"); // 02:45 -> 07:00
  });
  it("is a no-op when start equals end", () => {
    const at = new Date("2026-10-21T17:30:00Z");
    expect(afterQuietHours(at, z, "00:00", "00:00")).toBe(at);
  });
});
