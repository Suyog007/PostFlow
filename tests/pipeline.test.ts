import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { fillCalendar } from "../src/server/generate";
import { saveSettings } from "../src/server/settings";
import { GOOD_REVIEW, fakeLLM, resetDb } from "./helpers";

// Wed 2026-10-21 03:00Z = 08:45 Kathmandu. Next X slot 09:30 NPT = 03:45Z.
const NOW = new Date("2026-10-21T03:00:00Z");
const ONE_X_SLOT = [{ platform: "x" as const, days: [1, 2, 3, 4, 5, 6, 7], time: "09:30" }];

async function setup(horizonDays = 1) {
  await resetDb();
  await saveSettings({ slots: ONE_X_SLOT, horizonDays, pillars: { own_work: 1, news: 0, nepal: 0, learning: 0 } });
  await db().insert(schema.notes).values({ text: "This week I cut our cold-start time from 4s to 1.2s by lazy-loading the PDF renderer.", pillar: "own_work" });
}

const GOOD_POST = "Cut our cold start from 4s to 1.2s this week. The fix was boring: lazy-load the PDF renderer instead of importing it at the top of the module.";

describe("fillCalendar", () => {
  beforeEach(setup.bind(null, 1));

  it("writes, reviews and schedules a post from an owner note", async () => {
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: GOOD_POST } : GOOD_REVIEW));
    const r = await fillCalendar({ now: NOW, max: 1 });
    expect(r.produced).toBe(1);
    const [p] = await db().select().from(schema.posts);
    expect(p).toMatchObject({ status: "scheduled", platform: "x", pillar: "own_work", text: GOOD_POST });
    expect(p.scheduledAt.toISOString()).toBe("2026-10-21T03:45:00.000Z");
    expect(p.noteId).toBeTruthy();
  });

  it("is idempotent: a filled slot is not filled twice", async () => {
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: GOOD_POST } : GOOD_REVIEW));
    await fillCalendar({ now: NOW, max: 5 });
    const again = await fillCalendar({ now: NOW, max: 5 });
    expect(again.produced).toBe(0);
    expect(await db().select().from(schema.posts)).toHaveLength(1);
  });

  it("revises after reviewer feedback and then approves", async () => {
    let reviews = 0;
    const calls = fakeLLM((req) => {
      if (req.schemaName === "write_post") return { text: req.user.includes("editor rejected") ? GOOD_POST : "Cut cold start a lot. Huge improvement overall for everyone involved here." };
      reviews++;
      return reviews === 1 ? { ...GOOD_REVIEW, worth_posting: 4, issues: ["Vague: no numbers."], revision_instructions: "Add the 4s to 1.2s numbers." } : GOOD_REVIEW;
    });
    await fillCalendar({ now: NOW, max: 1 });
    const [p] = await db().select().from(schema.posts);
    expect(p.status).toBe("scheduled");
    expect(p.text).toBe(GOOD_POST);
    expect(calls.filter((c) => c.schemaName === "write_post")).toHaveLength(2);
    expect((p.review as { rounds: number }).rounds).toBe(2);
  });

  it("rejects a post with an unsupported claim, never schedules it", async () => {
    fakeLLM((req) =>
      req.schemaName === "write_post"
        ? { text: "We cut cold start by 70% across 40 customers." }
        : { ...GOOD_REVIEW, claims: [{ claim: "40 customers", support: "unsupported", evidence: "not in note" }] },
    );
    const r = await fillCalendar({ now: NOW, max: 1 });
    expect(r).toMatchObject({ produced: 0, rejected: 1 });
    const [p] = await db().select().from(schema.posts);
    expect(p.status).toBe("rejected");
    expect(p.error).toContain("Unsupported claim");
  });

  it("deterministic checks override a lenient reviewer", async () => {
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: "a".repeat(300) } : GOOD_REVIEW));
    await fillCalendar({ now: NOW, max: 1 });
    const [p] = await db().select().from(schema.posts);
    expect(p.status).toBe("rejected");
    expect(p.error).toMatch(/280/);
  });

  it("gives up on a slot after 3 rejected attempts instead of looping", async () => {
    await db().insert(schema.notes).values([{ text: "Second note about something I shipped on Friday with real detail.", pillar: "own_work" }, { text: "Third note about another thing I shipped with real detail.", pillar: "own_work" }, { text: "Fourth note about yet another thing I built with real detail.", pillar: "own_work" }]);
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: GOOD_POST } : { ...GOOD_REVIEW, worth_posting: 2 }));
    for (let i = 0; i < 5; i++) await fillCalendar({ now: NOW, max: 3 });
    const rows = await db().select().from(schema.posts);
    expect(rows.filter((r) => r.status === "rejected").length).toBeLessThanOrEqual(3);
    expect(rows.some((r) => r.status === "scheduled")).toBe(false);
  });

  it("does nothing while paused", async () => {
    await saveSettings({ paused: true });
    fakeLLM(() => ({}));
    expect(await fillCalendar({ now: NOW })).toMatchObject({ produced: 0, idle: "paused" });
  });

  it("does not refill a slot the owner removed", async () => {
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: GOOD_POST } : GOOD_REVIEW));
    await fillCalendar({ now: NOW, max: 1 });
    await db().update(schema.posts).set({ status: "cancelled" });
    await fillCalendar({ now: NOW, max: 3 });
    expect(await db().select().from(schema.posts)).toHaveLength(1);
  });
});

describe("time-sensitive news", () => {
  beforeEach(async () => {
    await resetDb();
    await saveSettings({ slots: ONE_X_SLOT, horizonDays: 3, minRelevance: 6, pillars: { own_work: 1, news: 1, nepal: 0, learning: 0 }, fastLane: { enabled: false, minRelevance: 9, maxPerDay: 1, leadMinutes: 45, platforms: ["x"], quietStart: "23:00", quietEnd: "07:00" } });
  });

  async function addItem(title: string, urgency: "breaking" | "week" | "evergreen", ageHours: number, relevance = 8) {
    const [it] = await db()
      .insert(schema.items)
      .values({ url: `https://example.com/${encodeURIComponent(title)}`, title, summary: `${title} summary with enough detail to write about it.`, pillar: "news", publishedAt: new Date(NOW.getTime() - ageHours * 3_600_000), relevance, urgency, analyzedAt: NOW })
      .returning();
    return it;
  }

  it("prioritises breaking news over evergreen and sets an expiry", async () => {
    await addItem("Evergreen guide to indexes", "evergreen", 5, 9);
    const breaking = await addItem("Vendor ships big launch", "breaking", 2, 7);
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: "Vendor X shipped a launch today. According to the announcement, it changes how builders deploy." } : GOOD_REVIEW));
    await fillCalendar({ now: NOW, max: 1 });
    const [p] = await db().select().from(schema.posts);
    expect(p.itemId).toBe(breaking.id);
    expect(p.expiresAt?.toISOString()).toBe(new Date(breaking.publishedAt.getTime() + 48 * 3_600_000).toISOString());
  });

  it("never schedules breaking news after it would be stale", async () => {
    // Published 47h ago: only ~1h of freshness left, first slot is 45 min away, but the 1h safety margin rules it out.
    await addItem("Old breaking story", "breaking", 47, 9);
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: "Story" } : GOOD_REVIEW));
    const r = await fillCalendar({ now: NOW, max: 1 });
    expect(r.produced).toBe(0);
  });

  it("bumps an unedited evergreen post to make room for breaking news", async () => {
    await saveSettings({ horizonDays: 1 });
    // The only slot in the next day is already taken by an evergreen post.
    await db().insert(schema.posts).values({ platform: "x", pillar: "learning", text: "Evergreen text", status: "scheduled", scheduledAt: new Date("2026-10-21T03:45:00Z") });
    await addItem("Fresh breaking launch", "breaking", 1, 9);
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: "Breaking launch. According to the announcement, builders should look at it today." } : GOOD_REVIEW));
    await fillCalendar({ now: NOW, max: 1 });
    const rows = await db().select().from(schema.posts);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toMatch(/Breaking launch/);
    expect(rows[0].expiresAt).toBeTruthy();
  });

  it("does not bump a post the owner edited", async () => {
    await saveSettings({ horizonDays: 1 });
    await db().insert(schema.posts).values({ platform: "x", pillar: "learning", text: "Mine", status: "scheduled", scheduledAt: new Date("2026-10-21T03:45:00Z"), userEdited: true });
    await addItem("Fresh breaking launch", "breaking", 1, 9);
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: "x" } : GOOD_REVIEW));
    await fillCalendar({ now: NOW, max: 1 });
    expect((await db().select().from(schema.posts).where(eq(schema.posts.userEdited, true)))[0].text).toBe("Mine");
  });

  it("caps time-sensitive posts so owner notes still get slots", async () => {
    await saveSettings({ horizonDays: 1, pillars: { own_work: 1, news: 1, nepal: 0, learning: 0 }, slots: [{ platform: "x", days: [1, 2, 3, 4, 5, 6, 7], time: "09:30" }, { platform: "x", days: [1, 2, 3, 4, 5, 6, 7], time: "12:30" }, { platform: "x", days: [1, 2, 3, 4, 5, 6, 7], time: "15:30" }] });
    await db().insert(schema.notes).values([{ text: "Note one: shipped the billing export and it halved support tickets for us.", pillar: "own_work" }, { text: "Note two: found that our cron drifted by 40s a day until we pinned the clock.", pillar: "own_work" }]);
    for (const t of ["Breaking one", "Breaking two", "Breaking three"]) await addItem(t, "breaking", 1, 9);
    const texts = ["Vendor launch today. According to the announcement, deploys need far less config now.", "Our billing export halved support tickets. Boring work, measurable result, worth repeating.", "Cron drifted forty seconds a day until we pinned the clock source. Check yours."];
    let n = 0;
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: texts[n++ % 3] } : GOOD_REVIEW));
    await fillCalendar({ now: NOW, max: 5 });
    const rows = await db().select().from(schema.posts).where(eq(schema.posts.status, "scheduled"));
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.expiresAt).length).toBe(1);
    expect(rows.filter((r) => r.noteId).length).toBe(2);
  });
});
