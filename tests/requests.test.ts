import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { createRequest, processRequests } from "../src/server/requests";
import { saveSettings } from "../src/server/settings";
import { setNewsSearchForTests } from "../src/server/verify";
import { setFetchArticleForTests } from "../src/server/net";
import { handleTelegramUpdate } from "../src/server/telegram-inbound";
import { GOOD_REVIEW, fakeLLM, resetDb } from "./helpers";

const SLOTS = [{ platform: "x" as const, days: [1, 2, 3, 4, 5, 6, 7], time: "19:30" }, { platform: "linkedin" as const, days: [1, 2, 3, 4, 5, 6, 7], time: "09:15" }];

beforeEach(async () => {
  await resetDb();
  await saveSettings({ slots: SLOTS });
});

const writer = (text: (req: { user: string }) => string) =>
  fakeLLM((req) => (req.schemaName === "write_post" ? { text: text(req) } : GOOD_REVIEW));

describe("create a post from an idea", () => {
  it("writes for both platforms and schedules them in the next free slots, protected from replacement", async () => {
    writer((r) => (r.user.includes("OWNER NOTE") ? "Most teams add caching before they measure. I check the query plan first, then decide." : "x"));
    await createRequest({ text: "Most teams add caching before measuring. I always check the query plan first." });
    expect(await processRequests({ max: 1 })).toBe(1);
    const posts = await db().select().from(schema.posts);
    expect(posts.map((p) => p.platform).sort()).toEqual(["linkedin", "x"]);
    expect(posts.every((p) => p.status === "scheduled" && p.userEdited)).toBe(true);
    expect((await db().select().from(schema.requests))[0].status).toBe("done");
  });

  it("draft mode never schedules", async () => {
    writer(() => "Idempotency keys make retries safe: send a key, store the result, return it again.");
    await createRequest({ text: "Idea: explain idempotency keys for webhook retries", mode: "draft", platforms: ["x"] });
    await processRequests({ max: 1 });
    const [p] = await db().select().from(schema.posts);
    expect(p.status).toBe("draft");
  });

  it("keeps a post as a draft when the reviewer objects, instead of throwing your idea away", async () => {
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: "A vague take on many things that people often think about." } : { ...GOOD_REVIEW, worth_posting: 3, issues: ["Too vague."] }));
    await createRequest({ text: "Idea: something about developers and tools generally", platforms: ["x"] });
    await processRequests({ max: 1 });
    const [p] = await db().select().from(schema.posts);
    expect(p.status).toBe("draft");
    expect(p.error).toContain("Reviewer");
  });

  it("rejects input that is too short", async () => {
    await expect(createRequest({ text: "hi" })).rejects.toThrow(/bit more/);
  });
});

describe("your own article", () => {
  const url = "https://myportfolio.dev/blog/lazy-loading-pdf";
  it("includes the link in the post and never a 'Source:' line", async () => {
    writer(() => "I walked through how lazy-loading one module took our cold start from 4s to 1.2s. The surprise was what caching hid.");
    await createRequest({ text: url, own: true, platforms: ["linkedin", "x"] });
    await processRequests({ max: 1 });
    const posts = await db().select().from(schema.posts);
    for (const p of posts) {
      expect(p.status).toBe("scheduled");
      expect(p.text.endsWith(url)).toBe(true);
      expect(p.text).not.toMatch(/source:/i);
    }
    expect(posts.find((p) => p.platform === "linkedin")!.text).toContain(`\n\n${url}`);
  });

  it("recognises your own domains without the checkbox", async () => {
    await saveSettings({ ownDomains: ["myportfolio.dev"] });
    const calls = writer(() => "I wrote up how lazy-loading one module cut our cold start, and what caching had hidden.");
    await createRequest({ text: url, platforms: ["x"] });
    await processRequests({ max: 1 });
    expect(calls.find((c) => c.schemaName === "write_post")!.user).toContain("THE OWNER'S OWN ARTICLE");
    expect((await db().select().from(schema.posts))[0].text).toContain(url);
  });
});

describe("a link to someone else's story", () => {
  const url = "https://ifreedomain.com/offer";
  it("keeps risky unconfirmed claims as drafts", async () => {
    setFetchArticleForTests(async () => ({ title: "iFreeDomain is giving free domains for one year", text: "Free domains for one year. ".repeat(30) }));
    setNewsSearchForTests(async () => []);
    writer(() => "iFreeDomain is offering free domains for a year, per its own page. Worth a look if you have a side project waiting for a name.");
    await createRequest({ text: url, platforms: ["x"] });
    await processRequests({ max: 1 });
    const [p] = await db().select().from(schema.posts);
    expect(p.status).toBe("draft");
  });

  it("schedules it when other publishers confirm", async () => {
    setFetchArticleForTests(async () => ({ title: "iFreeDomain is giving free domains for one year", text: "Free domains for one year. ".repeat(30) }));
    setNewsSearchForTests(async () => [{ domain: "techpana.com", title: "Free domain for a year from iFreeDomain, new offer", url: "https://techpana.com/x" }]);
    writer(() => "iFreeDomain is offering free domains for a year, according to its page and Techpana. Worth a look if a side project is waiting for a name.");
    await createRequest({ text: url, platforms: ["x"] });
    await processRequests({ max: 1 });
    expect((await db().select().from(schema.posts))[0].status).toBe("scheduled");
  });

  it("fails clearly when the page cannot be read and you gave no description", async () => {
    setFetchArticleForTests(async () => null);
    fakeLLM(() => ({}));
    await createRequest({ text: url });
    await processRequests({ max: 1 });
    const [r] = await db().select().from(schema.requests);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/could not read/i);
  });
});

describe("telegram", () => {
  const say = (text: string) => handleTelegramUpdate({ message: { chat: { id: 42 }, text } });
  it("/post, /draft and /mine create requests with the right mode", async () => {
    await say("/post An idea about measuring before caching anything at all");
    await say("/draft Another idea about retries and idempotency keys here");
    await say("/mine https://myportfolio.dev/blog/x");
    const rows = await db().select().from(schema.requests).orderBy(schema.requests.createdAt);
    expect(rows.map((r) => r.mode)).toEqual(["schedule", "draft", "schedule"]);
    expect(rows.map((r) => r.own)).toEqual([false, false, true]);
  });
  it("a plain link becomes a tip with a boosted place in the news pipeline", async () => {
    setFetchArticleForTests(async () => ({ title: "iFreeDomain is giving free domains for one year", text: "Free domains. ".repeat(40) }));
    await say("https://ifreedomain.com/offer");
    const [it] = await db().select().from(schema.items).where(eq(schema.items.url, "https://ifreedomain.com/offer"));
    expect(it.title).toContain("iFreeDomain");
    expect(it.analyzedAt).toBeNull();
  });
});
