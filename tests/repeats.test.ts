import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../src/server/db/client";
import { repeatedQueuedPosts } from "../src/server/generate";
import { me, resetDb } from "./helpers";

beforeEach(resetDb);

const hours = (h: number) => new Date(Date.now() + h * 3_600_000);
async function item(title: string) {
  const [it] = await db().insert(schema.items).values({ userId: me(), url: `https://example.com/${encodeURIComponent(title)}`, title, summary: title, pillar: "news", publishedAt: hours(-5) }).returning();
  return it;
}
async function post(platform: string, itemId: string, at: Date, extra: Partial<typeof schema.posts.$inferInsert> = {}) {
  const [p] = await db().insert(schema.posts).values({ userId: me(), platform, pillar: "news", itemId, text: "x", status: "scheduled", scheduledAt: at, ...extra }).returning();
  return p;
}

describe("the same story is told once, across LinkedIn and X", () => {
  it("finds later posts that repeat an earlier story, from the same article or another one", async () => {
    const node = await item("Node.js 24.22.1 (LTS) security release");
    const openai = await item("OpenAI disables internet access during model training");
    const openai2 = await item("OpenAI will stop training its models on the live internet");
    const other = await item("Google Cloud now offers OpenAI models alongside Gemini and Claude");
    await item("Filler headline about databases"); // more headlines so story keys are meaningful

    await post("linkedin", node.id, hours(-48), { status: "published" });
    const nodeAgain = await post("x", node.id, hours(30)); // already posted on LinkedIn
    const first = await post("linkedin", openai.id, hours(10));
    const second = await post("x", openai2.id, hours(20)); // same story, other article
    const approved = await post("x", openai.id, hours(40), { approvedAt: new Date() }); // you approved it: left alone
    const fine = await post("x", other.id, hours(50));

    const repeats = await repeatedQueuedPosts();
    expect(repeats.sort()).toEqual([nodeAgain.id, second.id].sort());
    expect(repeats).not.toContain(first.id);
    expect(repeats).not.toContain(approved.id);
    expect(repeats).not.toContain(fine.id);
  });
});

describe("stories that no longer clear the bar", () => {
  it("lists queued news posts whose story scores below the platform's minimum, but not ones you approved or edited", async () => {
    const { weakQueuedPosts } = await import("../src/server/generate");
    const { getSettings, saveSettings } = await import("../src/server/settings");
    await saveSettings({ linkedinMinRelevance: 7, minRelevance: 6 });
    const [weak] = await db().insert(schema.items).values({ userId: me(), url: "https://nodejs.org/r", title: "Node.js 26.12.1 (Current)", summary: "x", pillar: "news", publishedAt: hours(-5), relevance: 5 }).returning();
    const [strong] = await db().insert(schema.items).values({ userId: me(), url: "https://x.com/s", title: "A strong story", summary: "x", pillar: "news", publishedAt: hours(-5), relevance: 9 }).returning();
    const a = await post("linkedin", weak.id, hours(10));
    await post("x", weak.id, hours(11), { approvedAt: new Date() });
    await post("linkedin", weak.id, hours(12), { userEdited: true });
    await post("linkedin", strong.id, hours(13));
    expect(await weakQueuedPosts(await getSettings())).toEqual([a.id]);
  });
});
