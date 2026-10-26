import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../src/server/db/client";
import { extraQueuedLessons, fillCalendar } from "../src/server/generate";
import { getSettings, saveSettings } from "../src/server/settings";
import { GOOD_REVIEW, fakeLLM, me, resetDb } from "./helpers";

const NOW = new Date("2026-10-21T03:00:00Z");
const FAST_OFF = { enabled: false, minRelevance: 9, maxPerDay: 1, leadMinutes: 45, platforms: ["x" as const], quietStart: "23:00", quietEnd: "07:00" };
const SLOTS = [
  { platform: "x" as const, days: [1, 2, 3, 4, 5, 6, 7], time: "09:30" },
  { platform: "linkedin" as const, days: [1, 2, 3, 4, 5, 6, 7], time: "09:15" },
  { platform: "linkedin" as const, days: [1, 2, 3, 4, 5, 6, 7], time: "19:15" },
];

async function addItem(title: string, relevance = 9) {
  await db().insert(schema.items).values({ userId: me(), url: `https://example.com/${encodeURIComponent(title)}`, title, summary: `${title} summary text`, pillar: "news", publishedAt: new Date(NOW.getTime() - 3_600_000), relevance, urgency: "evergreen", analyzedAt: NOW });
}

beforeEach(async () => {
  await resetDb();
  await saveSettings({ slots: SLOTS, horizonDays: 1, fastLane: FAST_OFF, pillars: { own_work: 0, news: 1, local: 0, learning: 1 }, fillerPosts: false });
});

describe("news first, lessons to taste", () => {
  it("with strong news available, a day gets news and at most one written lesson, and the lesson explains this week's news", async () => {
    await addItem("Brotli decoder bug lets attackers run code in Node.js and Python");
    await addItem("WebSocket support is now generally available on a major host");
    await addItem("DeepSeek open-sources the inference engine behind its API");
    const calls = fakeLLM((req) =>
      req.schemaName === "pick_topic"
        ? { topic: "What a decompression bomb is", angle: "the idea behind this week's Brotli bug" }
        : req.schemaName === "write_post"
          ? { text: req.user.includes("decompression") ? "A tiny file can unpack into gigabytes and crash your server. That is a decompression bomb." : "A real story about developers, explained plainly for builders today." }
          : GOOD_REVIEW,
    );
    await fillCalendar({ now: NOW, max: 3 });
    const rows = await db().select().from(schema.posts);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.pillar === "learning").length).toBeLessThanOrEqual(1);
    expect(rows.filter((r) => r.pillar === "news").length).toBeGreaterThanOrEqual(2);
    const pick = calls.find((c) => c.schemaName === "pick_topic");
    if (pick) {
      expect(pick.user).toContain("Brotli decoder bug");
      expect(pick.system).toMatch(/Never a generic "how to use <tool> for <task>" tutorial/);
    }
  });

  it("with no news at all, still only one written lesson a day", async () => {
    fakeLLM((req) => (req.schemaName === "pick_topic" ? { topic: `Topic ${Math.random()}`, angle: "a" } : req.schemaName === "write_post" ? { text: "A clear short lesson for builders that explains one idea plainly." } : GOOD_REVIEW));
    await fillCalendar({ now: NOW, max: 3 });
    expect((await db().select().from(schema.posts)).filter((r) => r.pillar === "learning")).toHaveLength(1);
  });

  it("lists queued written lessons beyond one a day, keeping the first and any you approved or edited", async () => {
    const day = (h: number) => new Date(Date.UTC(2026, 10, 2, h));
    const ins = (h: number, extra: Partial<typeof schema.posts.$inferInsert> = {}) => db().insert(schema.posts).values({ userId: me(), platform: "x", pillar: "learning", text: "x", status: "scheduled", scheduledAt: day(h), ...extra }).returning();
    await ins(3);
    const [second] = await ins(5);
    await ins(7, { approvedAt: new Date() });
    await ins(8, { userEdited: true });
    expect(await extraQueuedLessons(await getSettings())).toEqual([second.id]);
  });
});
