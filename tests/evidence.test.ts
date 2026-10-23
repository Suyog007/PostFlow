import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { fillCalendar, quoteInSource, recheckPost } from "../src/server/generate";
import { saveSettings } from "../src/server/settings";
import { GOOD_REVIEW, fakeLLM, me, resetDb } from "./helpers";

const FAST_OFF = { enabled: false, minRelevance: 9, maxPerDay: 1, leadMinutes: 45, platforms: ["x" as const], quietStart: "23:00", quietEnd: "07:00" };
const SUMMARY = "Acme released Acme DB 2.0 on Tuesday. Backups are now 3x faster, the team said.";

async function addItem() {
  const [it] = await db()
    .insert(schema.items)
    .values({ userId: me(), url: "https://example.com/acme-db-2", title: "Acme DB 2.0 ships with faster backups", summary: SUMMARY, body: SUMMARY, pillar: "news", publishedAt: new Date(Date.now() - 3_600_000), relevance: 9, urgency: "evergreen", analyzedAt: new Date() })
    .returning();
  return it;
}

beforeEach(async () => {
  await resetDb();
  await saveSettings({ slots: [{ platform: "x", days: [1, 2, 3, 4, 5, 6, 7], time: "09:30" }], horizonDays: 2, fastLane: FAST_OFF, pillars: { own_work: 0, news: 1, local: 0, learning: 0 } });
});

describe("writer's evidence", () => {
  it("checks quotes word for word, ignoring case, curly quotes and spacing", () => {
    expect(quoteInSource("backups are now 3x  faster", SUMMARY)).toBe(true);
    expect(quoteInSource("“Acme released Acme DB 2.0”", SUMMARY)).toBe(true);
    expect(quoteInSource("Acme released ... 3x faster", SUMMARY)).toBe(true);
    expect(quoteInSource("Backups are now 10x faster", SUMMARY)).toBe(false);
    expect(quoteInSource("", SUMMARY)).toBe(false);
  });

  it("goes to the reviewer with FOUND / NOT FOUND, is stored on the post, and never ends up in the text", async () => {
    await addItem();
    const calls = fakeLLM((req) =>
      req.schemaName === "write_post"
        ? { text: "Acme DB 2.0 is out, Acme says backups are 3x faster. I'd expect small teams to switch this month.", evidence: [{ claim: "Backups are 3x faster", quote: "Backups are now 3x faster" }, { claim: "It is free", quote: "free for everyone" }] }
        : GOOD_REVIEW,
    );
    await fillCalendar({ max: 1 });
    const review = calls.find((c) => c.schemaName === "review_post")!;
    expect(review.user).toContain('"Backups are now 3x faster" [FOUND]');
    expect(review.user).toContain('"free for everyone" [NOT FOUND]');
    const [p] = await db().select().from(schema.posts);
    expect(p.text).not.toMatch(/Backups are now|https?:/);
    expect((p.review as { evidence: { found: boolean }[] }).evidence.map((e) => e.found)).toEqual([true, false]);
  });
});

describe("check again", () => {
  async function heldBack() {
    const it = await addItem();
    const [p] = await db()
      .insert(schema.posts)
      .values({
        userId: me(),
        platform: "x",
        pillar: "news",
        text: "Acme DB 2.0 is out, Acme says backups are 3x faster. I'd expect small teams to switch this month.",
        status: "rejected",
        scheduledAt: new Date(Date.now() + 5 * 3_600_000),
        itemId: it.id,
        review: { verdict: { approved: false, reasons: ["Not worth posting (4/10): the prediction is stated as fact."] }, evidence: [{ claim: "3x faster", quote: "Backups are now 3x faster", found: true }] },
        error: "Reviewer: Not worth posting (4/10)",
      })
      .returning();
    return p;
  }

  it("a careful second review that clears the concerns puts the post back on the calendar", async () => {
    const p = await heldBack();
    const calls = fakeLLM(() => GOOD_REVIEW);
    const r = await recheckPost(p.id);
    expect(r.approved).toBe(true);
    const req = calls[0];
    expect(req.reasoningEffort).toBe("high");
    expect(req.user).toContain("A FIRST REVIEWER HELD THIS DRAFT BACK");
    expect(req.user).toContain("the prediction is stated as fact");
    const after = (await db().select().from(schema.posts).where(eq(schema.posts.id, p.id)))[0];
    expect(after).toMatchObject({ status: "scheduled", error: null, approvedAt: null });
    expect(after.scheduledAt.getTime()).toBe(p.scheduledAt.getTime());
  });

  it("when the second review agrees, the post stays held back, and it can only be asked twice", async () => {
    const p = await heldBack();
    fakeLLM(() => ({ ...GOOD_REVIEW, factual: 3, claims: [{ claim: "3x faster", support: "unsupported", evidence: "not in source" }] }));
    expect((await recheckPost(p.id)).approved).toBe(false);
    expect((await recheckPost(p.id)).approved).toBe(false);
    await expect(recheckPost(p.id)).rejects.toThrow(/already been checked again twice/);
    const after = (await db().select().from(schema.posts).where(eq(schema.posts.id, p.id)))[0];
    expect(after.status).toBe("rejected");
    expect(after.error).toMatch(/second check/);
  });
});
