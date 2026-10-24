import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../src/server/db/client";
import { resetEnvCache } from "../src/server/env";
import { handleTelegramUpdate } from "../src/server/telegram-inbound";
import { parseXUrl, readXPost, setArticleFinderForTests, setXReaderForTests } from "../src/server/research";
import { setFetchArticleForTests } from "../src/server/net";
import { setNewsSearchForTests } from "../src/server/verify";
import { saveSettings } from "../src/server/settings";
import { GOOD_ASSESSMENT, GOOD_REVIEW, fakeLLM, resetDb } from "./helpers";

const JACK = "https://x.com/jack/status/1981234567890123456";
const msg = (text: string) => ({ message: { chat: { id: 42 }, text } });

type Sent = { text: string; buttons?: { text: string; callback_data: string }[][] };
async function telegram<T>(fn: (sent: Sent[]) => Promise<T>) {
  process.env.TELEGRAM_BOT_TOKEN = "123:test";
  resetEnvCache();
  const sent: Sent[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_u: string, init?: { body?: string }) => {
    const b = JSON.parse(init?.body ?? "{}");
    if (b.text ?? b.caption) sent.push({ text: b.text ?? b.caption, buttons: b.reply_markup?.inline_keyboard });
    return new Response(JSON.stringify({ ok: true }));
  }) as typeof fetch;
  try {
    return await fn(sent);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    resetEnvCache();
  }
}

beforeEach(async () => {
  await resetDb();
  await saveSettings({ slots: [{ platform: "x", days: [1, 2, 3, 4, 5, 6, 7], time: "00:30" }, { platform: "linkedin", days: [1, 2, 3, 4, 5, 6, 7], time: "00:30" }], horizonDays: 2 });
});

describe("reading X posts", () => {
  it("recognises X and Twitter post links", () => {
    expect(parseXUrl(JACK)).toEqual({ handle: "jack", id: "1981234567890123456" });
    expect(parseXUrl("https://twitter.com/jack/status/1981234567890123456?s=20")).toMatchObject({ id: "1981234567890123456" });
    expect(parseXUrl("https://mobile.twitter.com/jack/statuses/1981234567890123456")).toMatchObject({ handle: "jack" });
    expect(parseXUrl("https://x.com/jack")).toBeNull();
    expect(parseXUrl("https://example.com/jack/status/1")).toBeNull();
  });

  it("reads the post through X's public embed feed: text, author, and the links it points to", async () => {
    setXReaderForTests(null); // the real reader, against a stubbed network
    const realFetch = globalThis.fetch;
    const asked: string[] = [];
    globalThis.fetch = (async (u: string) => {
      asked.push(String(u));
      return new Response(
        JSON.stringify({
          text: "We believe voice is the most natural way to interact with intelligence, so we created Dessa. https://t.co/abc123",
          created_at: "2026-10-24T00:08:00.000Z",
          user: { name: "jack", screen_name: "jack" },
          entities: { urls: [{ expanded_url: "https://block.xyz/dessa" }, { expanded_url: "https://x.com/someone/status/1" }] },
        }),
      );
    }) as typeof fetch;
    try {
      const post = await readXPost(JACK);
      expect(asked[0]).toMatch(/^https:\/\/cdn\.syndication\.twimg\.com\/tweet-result\?id=1981234567890123456&lang=en&token=\w+/);
      expect(post).toMatchObject({ author: "jack", handle: "jack", links: ["https://block.xyz/dessa"] });
      expect(post!.text).toBe("We believe voice is the most natural way to interact with intelligence, so we created Dessa.");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("falls back to oEmbed when the embed feed does not answer", async () => {
    setXReaderForTests(null);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: string) =>
      String(u).includes("syndication")
        ? new Response("nope", { status: 404 })
        : new Response(JSON.stringify({ author_name: "jack", author_url: "https://twitter.com/jack", html: '<blockquote><p lang="en">Talking with it feels like talking with a person. <a href="https://t.co/xyz">block.xyz/dessa</a></p>&mdash; jack</blockquote>' }))) as typeof fetch;
    try {
      const post = await readXPost(JACK);
      expect(post).toMatchObject({ author: "jack", handle: "jack" });
      expect(post!.text).toContain("Talking with it feels like talking with a person.");
      expect(post!.links).toEqual(["https://t.co/xyz"]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("going deeper before writing", () => {
  beforeEach(() => {
    setXReaderForTests(async () => ({
      url: JACK,
      author: "jack",
      handle: "jack",
      text: "We believe voice is the most natural way to interact with intelligence, so we created Dessa, the most authentic full-duplex speech model ever built.",
      createdAt: "2026-10-24T00:08:00.000Z",
      links: ["https://block.xyz/dessa"],
      quoted: null,
    }));
    setFetchArticleForTests(async (url) => ({ title: url.includes("block.xyz") ? "Dessa - the Conversation Model trained only on speech" : "Another outlet on Dessa", text: "Dessa is a speech model that listens and talks at the same time. It is small enough to run on a MacBook. ".repeat(10) }));
    setNewsSearchForTests(async () => [{ domain: "theverge.com", title: "Block's Dessa talks like a person", url: "https://theverge.com/x" }]);
    setArticleFinderForTests(async () => ["https://theverge.com/2026/10/24/dessa"]);
  });

  it("an X link is read, its linked page and other coverage are gathered, judged, then written and sent back", async () => {
    const calls = fakeLLM((req) =>
      req.schemaName === "assess_story"
        ? { worth: 8, why: "A new speech model small enough for a laptop; builders will want to try it.", kind: "opportunity", facts: [{ fact: "Dessa runs on a MacBook", source: "block.xyz" }], angle: "Voice apps without a server bill." }
        : req.schemaName === "write_post"
          ? { text: "A speech model that listens and talks at once, small enough for a MacBook.\n\nBlock's Dessa, per its launch page. #voiceai" }
          : GOOD_REVIEW,
    );
    await telegram(async (sent) => {
      await handleTelegramUpdate(msg(JACK));
      expect(sent[0].text).toMatch(/Looking into it/);
      expect(sent.some((m) => m.text.startsWith("🔎 Looked into it: 8/10."))).toBe(true);
      expect(sent.filter((m) => m.text.startsWith("✍️ Ready")).length).toBe(2);
    });
    const research = calls.find((c) => c.schemaName === "assess_story")!;
    expect(research.user).toContain("THE X POST by jack (@jack)");
    expect(research.user).toContain("THE PAGE THE POST LINKS TO (block.xyz)");
    expect(research.user).toContain("theverge.com: Block's Dessa talks like a person");
    expect(research.user).toContain("ANOTHER PUBLISHER'S ARTICLE (theverge.com)");
    const writer = calls.find((c) => c.schemaName === "write_post")!;
    expect(writer.user).toContain("FACT SHEET");
    expect(writer.user).toContain("Dessa runs on a MacBook (block.xyz)");
    expect((await db().select().from(schema.posts)).length).toBe(2);
  });

  it("when the research finds it weak, nothing is written; you are told why and can write it anyway", async () => {
    fakeLLM((req) =>
      req.schemaName === "assess_story"
        ? { ...GOOD_ASSESSMENT, worth: 4, why: "Mostly a founder's claim with no details yet." }
        : req.schemaName === "write_post"
          ? { text: "Block says Dessa sounds like a person. The launch page shows it running on a laptop. #voiceai" }
          : GOOD_REVIEW,
    );
    let req: typeof schema.requests.$inferSelect;
    await telegram(async (sent) => {
      await handleTelegramUpdate(msg(JACK));
      const why = sent.find((m) => m.text.includes("do not think it is worth a post (4/10)"))!;
      expect(why.text).toContain("Mostly a founder's claim");
      [req] = await db().select().from(schema.requests);
      expect(req.status).toBe("skipped");
      expect(why.buttons![0][0]).toMatchObject({ text: "✍️ Write it anyway", callback_data: `fw:${req.id}` });
      expect(await db().select().from(schema.posts)).toHaveLength(0);

      await handleTelegramUpdate({ callback_query: { id: "1", data: `fw:${req.id}`, message: { chat: { id: 42 } } } });
      expect(sent.filter((m) => m.text.startsWith("✍️ Ready")).length).toBe(2);
    });
    expect((await db().select().from(schema.posts)).length).toBe(2);
  });

  it("/dig looks up news you only heard about, and says so when it finds nothing", async () => {
    const calls = fakeLLM((req) => (req.schemaName === "write_post" ? { text: "Block's new speech model talks and listens at the same time.\n\nAnd it fits on a laptop, per The Verge. #voiceai" } : GOOD_REVIEW));
    await telegram(async (sent) => {
      await handleTelegramUpdate(msg("/dig jack dorsey launched a voice model called dessa"));
      expect(sent.some((m) => m.text.startsWith("✍️ Ready"))).toBe(true);
    });
    expect(calls.find((c) => c.schemaName === "assess_story")!.user).toContain("WHAT THE OWNER SENT");

    setNewsSearchForTests(async () => []);
    setArticleFinderForTests(async () => []);
    await telegram(async (sent) => {
      await handleTelegramUpdate(msg("/dig a rumour nobody has written about"));
      expect(sent.some((m) => m.text.includes("could not find any coverage"))).toBe(true);
    });
  });
});
