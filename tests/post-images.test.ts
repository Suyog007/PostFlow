import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { altText, cardUrl, drawPrompt, ensurePostImage, setAiDrawerForTests, shrink, redrawPostImage, setImageMakingForTests, setPhotoDownloadForTests, setPhotoSearchForTests, verifyCard, wantsImage, type Photo } from "../src/server/post-images";
import { withUser } from "../src/server/context";
import { publishDue } from "../src/server/publisher";
import { saveSettings } from "../src/server/settings";
import { setPlatformClientForTests } from "../src/server/platforms/accounts";
import type { PublishOptions } from "../src/server/platforms/types";
import { GOOD_REVIEW, fakeLLM, me, resetDb } from "./helpers";

const POST = "GitLab fixed a bug that sat in its code for 12 years.\n\nAnyone could run code on an unpatched server, per The Register. Patching is the whole fix.\n\n#gitlab #security";
const SEARCHES = { queries: ["padlock", "server room", "code screen"] };
const jpeg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, n]), Buffer.alloc(20)]);
const photo = (n: number): Photo => ({ url: `https://images.example/${n}.jpg`, source: `https://library.example/photo/${n}`, credit: `Someone ${n} on Pexels` });

/** Photos on, with the library stubbed. Returns the searches it was asked for. */
function library(results: (q: string) => Photo[] = () => [photo(1), photo(2), photo(3)]) {
  const asked: string[] = [];
  setImageMakingForTests(true);
  setPhotoSearchForTests(async (q) => {
    asked.push(q);
    return results(q);
  });
  setPhotoDownloadForTests(async (url) => ({ data: jpeg(Number(url.match(/(\d+)\.jpg/)![1])), mime: "image/jpeg" }));
  return asked;
}

async function scheduledPost(platform = "x") {
  const [p] = await db().insert(schema.posts).values({ userId: me(), platform, pillar: "news", text: POST, status: "scheduled", scheduledAt: new Date(Date.now() + 3_600_000) }).returning();
  return p;
}

describe("picture basics", () => {
  it("alt text is the first line without hashtags or links", () => {
    expect(altText({ text: POST })).toBe("GitLab fixed a bug that sat in its code for 12 years.");
    expect(altText({ text: "#ai Big news https://x.co/a today\nmore" })).toBe("Big news today");
  });

  it("only signed links work, and a changed post gets a new link", () => {
    const post = { id: "00000000-0000-4000-8000-000000000002", updatedAt: new Date("2026-10-24T01:00:00Z") };
    const u = new URL(cardUrl(post));
    expect(verifyCard(post.id, u.searchParams.get("v"), u.searchParams.get("s"))).toBe(true);
    expect(verifyCard(post.id, u.searchParams.get("v"), "0".repeat(32))).toBe(false);
    expect(verifyCard("00000000-0000-4000-8000-000000000003", u.searchParams.get("v"), u.searchParams.get("s"))).toBe(false);
    expect(cardUrl({ ...post, updatedAt: new Date("2026-10-24T02:00:00Z") })).not.toBe(cardUrl(post));
  });

  it("is on per platform in Settings and can be switched off for one post", () => {
    const s = { images: { linkedin: true, x: false } };
    expect(wantsImage({ platform: "linkedin", review: {} }, s)).toBe(true);
    expect(wantsImage({ platform: "x", review: {} }, s)).toBe(false);
    expect(wantsImage({ platform: "linkedin", review: { noImage: true } }, s)).toBe(false);
  });
});

describe("finding the photo", () => {
  beforeEach(resetDb);

  it("asks the writer what to search for, takes the first photo, stores it with its credit", async () => {
    const asked = library();
    const calls = fakeLLM((req) => (req.schemaName === "image_search" ? SEARCHES : GOOD_REVIEW));
    const p = await scheduledPost();
    const img = await withUser(me(), () => ensurePostImage(p));
    expect(img).toMatchObject({ mime: "image/jpeg", prompt: "padlock", source: "https://library.example/photo/1", credit: "Someone 1 on Pexels" });
    expect(calls.find((c) => c.schemaName === "image_search")!.user).toContain("GitLab fixed a bug");
    expect(asked).toEqual(["padlock"]);

    // Second time it comes from storage.
    await withUser(me(), () => ensurePostImage(p));
    expect(asked).toHaveLength(1);
  });

  it("does not use the same photo for two posts, and moves on to the next search when one finds nothing", async () => {
    library((q) => (q === "padlock" ? [photo(1)] : q === "server room" ? [] : [photo(7)]));
    fakeLLM(() => SEARCHES);
    const a = await withUser(me(), async () => ensurePostImage(await scheduledPost("x")));
    const b = await withUser(me(), async () => ensurePostImage(await scheduledPost("linkedin")));
    expect(a!.source).toBe("https://library.example/photo/1");
    expect(b).toMatchObject({ prompt: "code screen", source: "https://library.example/photo/7" });
  });

  it("New picture swaps in a different photo and changes the link; if none is found the old one stays", async () => {
    library();
    fakeLLM(() => SEARCHES);
    const p = await scheduledPost();
    await withUser(me(), () => ensurePostImage(p));
    const again = await withUser(me(), () => redrawPostImage(p));
    expect(again!.source).toBe("https://library.example/photo/2");
    expect(await db().select().from(schema.postImages)).toHaveLength(1);
    const after = (await db().select().from(schema.posts).where(eq(schema.posts.id, p.id)))[0];
    expect(cardUrl(after)).not.toBe(cardUrl(p));

    library(() => []);
    expect(await withUser(me(), () => redrawPostImage(after))).toBeNull();
    expect((await db().select().from(schema.postImages))[0].source).toBe("https://library.example/photo/2");
  });

  it("serves the stored photo on a signed link and refuses anything else", async () => {
    library();
    fakeLLM(() => SEARCHES);
    const { GET } = await import("../src/app/api/cards/[id]/route");
    const p = await scheduledPost();
    const res = await GET(new Request(cardUrl(p)), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(jpeg(1));

    const bad = await GET(new Request(`http://localhost/api/cards/${p.id}?v=1&s=nope`), { params: Promise.resolve({ id: p.id }) });
    expect(bad.status).toBe(404);
  });

  it("when nothing is found, nothing is stored, the reason is kept, and it waits before searching again", async () => {
    const asked = library(() => {
      throw new Error("Openverse HTTP 503");
    });
    fakeLLM(() => SEARCHES);
    const p = await scheduledPost();
    expect(await withUser(me(), () => ensurePostImage(p))).toBeNull();
    expect(await db().select().from(schema.postImages)).toHaveLength(0);
    expect((await db().select().from(schema.llmCalls)).find((c) => c.task === "find_image")!.error).toContain("Openverse HTTP 503");
    const before = asked.length;
    await withUser(me(), () => ensurePostImage(p));
    expect(asked.length).toBe(before);
  });
});

describe("publishing with the photo", () => {
  beforeEach(resetDb);
  const NOW = new Date("2026-10-21T04:00:00Z");

  function recordingClient(fail?: (opts: PublishOptions) => string | null) {
    const calls: PublishOptions[] = [];
    setPlatformClientForTests("x", {
      async publish(_parts, _creds, opts = {}) {
        calls.push(opts);
        const err = fail?.(opts);
        return err ? { kind: "failed", retryable: false, error: err } : { kind: "success", externalIds: ["1"] };
      },
      async findRecentPost() {
        return null;
      },
    });
    return calls;
  }

  async function duePost() {
    await saveSettings({ requireApproval: false });
    const [p] = await db().insert(schema.posts).values({ userId: me(), platform: "x", pillar: "news", text: POST, status: "scheduled", scheduledAt: new Date("2026-10-21T03:45:00Z") }).returning();
    return p;
  }

  it("attaches the photo, with the first line as its alt text", async () => {
    library();
    fakeLLM(() => SEARCHES);
    const calls = recordingClient();
    await duePost();
    expect((await publishDue({ now: NOW })).published).toBe(1);
    expect(calls[0].media).toHaveLength(1);
    expect(calls[0].media![0]).toMatchObject({ mime: "image/jpeg", alt: "GitLab fixed a bug that sat in its code for 12 years." });
  });

  it("still posts, as text only, when no photo is found or the upload fails", async () => {
    library(() => []);
    fakeLLM(() => SEARCHES);
    let calls = recordingClient();
    const a = await duePost();
    await publishDue({ now: NOW });
    expect(calls[0].media).toBeUndefined();
    expect((await db().select().from(schema.posts).where(eq(schema.posts.id, a.id)))[0].status).toBe("published");

    await resetDb();
    library();
    fakeLLM(() => SEARCHES);
    calls = recordingClient((o) => (o.media?.length ? "X media upload failed (HTTP 400): bad image" : null));
    const b = await duePost();
    await publishDue({ now: NOW });
    expect(calls).toHaveLength(2);
    expect(calls[1].media).toBeUndefined();
    expect((await db().select().from(schema.posts).where(eq(schema.posts.id, b.id)))[0].status).toBe("published");
  });

  it("goes without a photo when pictures are off for the platform", async () => {
    const asked = library();
    fakeLLM(() => SEARCHES);
    const calls = recordingClient();
    await duePost();
    await saveSettings({ images: { linkedin: true, x: false } });
    await publishDue({ now: NOW });
    expect(calls[0].media).toBeUndefined();
    expect(asked).toHaveLength(0);
  });
});

describe("rewriting queued posts in the new style", () => {
  beforeEach(resetDb);

  it("rewrites unapproved posts from the same story, leaves approved and edited ones alone, and keeps the old one if the rewrite fails", async () => {
    const { rewriteFresh } = await import("../src/server/generate");
    const at = (h: number) => new Date(Date.now() + h * 3_600_000);
    const [item] = await db().insert(schema.items).values({ userId: me(), url: "https://theregister.com/gitlab", title: "GitLab patches a 12-year-old RCE", summary: "GitLab patched a remote code execution bug.", body: "GitLab patched a remote code execution bug that was 12 years old. ".repeat(10), pillar: "news", publishedAt: new Date() }).returning();
    const [old, approved, edited] = await db()
      .insert(schema.posts)
      .values([
        { userId: me(), platform: "x", pillar: "news" as const, itemId: item.id, text: "I expect many teams will patch GitLab.", status: "scheduled" as const, scheduledAt: at(5) },
        { userId: me(), platform: "x", pillar: "news" as const, itemId: item.id, text: "Approved already.", status: "scheduled" as const, scheduledAt: at(6), approvedAt: new Date() },
        { userId: me(), platform: "x", pillar: "news" as const, itemId: item.id, text: "My own words.", status: "scheduled" as const, scheduledAt: at(7), userEdited: true },
      ])
      .returning();

    const calls = fakeLLM((req) => (req.schemaName === "write_post" ? { text: "GitLab carried a remote-code bug for 12 years.\n\nPer The Register, the fix is out. #gitlab" } : GOOD_REVIEW));
    expect(await rewriteFresh(old.id)).toBe("rewritten");
    expect(await rewriteFresh(approved.id)).toBe("kept");
    expect(await rewriteFresh(edited.id)).toBe("kept");
    expect(calls.filter((c) => c.schemaName === "write_post")).toHaveLength(1);
    const live = (await db().select().from(schema.posts)).filter((p) => p.status === "scheduled");
    expect(live.map((p) => p.text).sort()).toEqual(["Approved already.", "GitLab carried a remote-code bug for 12 years.\n\nPer The Register, the fix is out. #gitlab", "My own words."].sort());

    // A rewrite the reviewer rejects leaves the post that was there.
    const [another] = await db().insert(schema.posts).values({ userId: me(), platform: "x", pillar: "news", itemId: item.id, text: "Old but fine.", status: "scheduled", scheduledAt: at(9) }).returning();
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: "Something worse about GitLab and nothing else at all." } : { ...GOOD_REVIEW, worth_posting: 2, issues: ["Says nothing."] }));
    expect(await rewriteFresh(another.id)).toBe("kept");
    expect((await db().select().from(schema.posts).where(eq(schema.posts.id, another.id)))[0]).toMatchObject({ status: "scheduled", text: "Old but fine." });
  });
});

describe("picture buttons in Telegram", () => {
  beforeEach(resetDb);

  it("New picture sends the post back with a different photo; No picture switches it off", async () => {
    const { handleTelegramUpdate } = await import("../src/server/telegram-inbound");
    const { resetEnvCache } = await import("../src/server/env");
    library();
    fakeLLM(() => SEARCHES);
    const p = await scheduledPost();
    await withUser(me(), () => ensurePostImage(p));

    process.env.TELEGRAM_BOT_TOKEN = "123:test";
    resetEnvCache();
    const sent: { method: string; body: Record<string, unknown> }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: string, init?: { body?: string }) => {
      sent.push({ method: String(u).split("/").pop()!, body: JSON.parse(init?.body ?? "{}") });
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch;
    try {
      await handleTelegramUpdate({ callback_query: { id: "1", data: `ni:${p.id}`, message: { chat: { id: 42 } } } });
      const msg = sent.find((m) => m.method === "sendPhoto")!;
      expect(msg.body.caption).toMatch(/^🎨 New picture/);
      expect(JSON.stringify(msg.body.reply_markup)).toContain(`xi:${p.id}`);
      expect((await db().select().from(schema.postImages))[0].source).toBe("https://library.example/photo/2");

      await handleTelegramUpdate({ callback_query: { id: "2", data: `xi:${p.id}`, message: { chat: { id: 42 } } } });
      const row = (await db().select().from(schema.posts).where(eq(schema.posts.id, p.id)))[0];
      expect(row.review).toMatchObject({ noImage: true });
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.TELEGRAM_BOT_TOKEN;
      resetEnvCache();
    }
  });
});

describe("the photo libraries", () => {
  beforeEach(resetDb);

  it("uses Pexels when a key is set, and public-domain Openverse photos otherwise", async () => {
    const { resetEnvCache } = await import("../src/server/env");
    setImageMakingForTests(true);
    setPhotoSearchForTests(null); // the real libraries, against a stubbed network
    setPhotoDownloadForTests(async (url) => ({ data: Buffer.from(url), mime: "image/jpeg" }));
    fakeLLM(() => SEARCHES);
    const asked: { url: string; auth?: string }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: string, init?: { headers?: Record<string, string> }) => {
      asked.push({ url: String(u), auth: init?.headers?.Authorization });
      if (String(u).startsWith("https://api.pexels.com/"))
        return new Response(JSON.stringify({ photos: [{ id: 5, url: "https://www.pexels.com/photo/padlock-5/", photographer: "Ana", src: { landscape: "https://images.pexels.com/photos/5/landscape.jpeg" } }] }));
      return new Response(JSON.stringify({ results: [{ url: "https://live.staticflickr.com/1/padlock.jpg", foreign_landing_url: "https://flickr.com/photos/1", creator: "Bo" }] }));
    }) as typeof fetch;
    try {
      const a = await withUser(me(), async () => ensurePostImage(await scheduledPost("x")));
      expect(a).toMatchObject({ source: "https://flickr.com/photos/1", credit: "Bo via Openverse (public domain)" });
      const ov = new URL(asked.find((r) => r.url.includes("openverse"))!.url);
      expect(ov.searchParams.get("license")).toBe("cc0,pdm");
      expect(ov.searchParams.get("q")).toBe("padlock");
      expect(asked.some((r) => r.url.includes("pexels"))).toBe(false);

      process.env.PEXELS_API_KEY = "px-test";
      resetEnvCache();
      const b = await withUser(me(), async () => ensurePostImage(await scheduledPost("linkedin")));
      expect(b).toMatchObject({ source: "https://www.pexels.com/photo/padlock-5/", credit: "Ana on Pexels" });
      expect(b!.data.toString()).toBe("https://images.pexels.com/photos/5/landscape.jpeg");
      expect(asked.find((r) => r.url.includes("pexels"))!.auth).toBe("px-test");
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.PEXELS_API_KEY;
      resetEnvCache();
    }
  });
});

describe("AI illustrations", () => {
  beforeEach(resetDb);
  const SCENE = { style: "cinematic photograph", scene: "A massive bank vault door held shut by a single bent paper clip, cold blue light, dust in the air, a tiny figure staring up at it from the floor." };
  const realPng = async (w: number, h: number) => (await import("sharp")).default({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 60, b: 200 } } }).png().toBuffer();

  it("when an image model is set up, the post gets an illustration of its point, cut to 1200x675 JPEG", async () => {
    const prompts: string[] = [];
    setImageMakingForTests(true);
    setAiDrawerForTests(async (prompt) => {
      prompts.push(prompt);
      return realPng(1024, 1024);
    });
    const asked = library();
    const calls = fakeLLM((req) => (req.schemaName === "image_scene" ? SCENE : SEARCHES));
    const p = await scheduledPost("linkedin");
    const img = await withUser(me(), () => ensurePostImage(p));
    expect(calls.find((c) => c.schemaName === "image_scene")!.system).toMatch(/no lone padlock, key/);
    expect(prompts[0]).toContain("paper clip");
    expect(prompts[0]).toMatch(/No text, no letters/);
    expect(img).toMatchObject({ mime: "image/jpeg", credit: "AI illustration made for this post" });
    const meta = await (await import("sharp")).default(img!.data).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1200, 675, "jpeg"]);
    expect(asked).toHaveLength(0); // no photo search needed
  });

  it("falls back to a photo when the image model fails, and keeps why", async () => {
    setImageMakingForTests(true);
    setAiDrawerForTests(async () => {
      throw new Error("Cloudflare HTTP 429: daily free allocation used");
    });
    library();
    fakeLLM((req) => (req.schemaName === "image_scene" ? SCENE : SEARCHES));
    const img = await withUser(me(), async () => ensurePostImage(await scheduledPost()));
    expect(img!.source).toBe("https://library.example/photo/1");
  });

  it("big downloaded photos are made small", async () => {
    const big = await (await import("sharp")).default({ create: { width: 4000, height: 3000, channels: 3, background: { r: 200, g: 100, b: 50 } } }).jpeg({ quality: 100 }).toBuffer();
    const out = await shrink(big);
    const meta = await (await import("sharp")).default(out!.data).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 675]);
    expect(out!.data.length).toBeLessThan(big.length);
    expect(drawPrompt(SCENE)).toContain("bank vault");
  });
});

describe("Cloudflare Workers AI", () => {
  beforeEach(resetDb);

  it("drops a setting the model refuses and asks again", async () => {
    const { resetEnvCache } = await import("../src/server/env");
    process.env.CLOUDFLARE_ACCOUNT_ID = "acc123";
    process.env.CLOUDFLARE_API_TOKEN = "cf-token";
    resetEnvCache();
    setImageMakingForTests(true);
    setAiDrawerForTests(undefined); // the real Cloudflare call, against a stubbed network
    fakeLLM(() => ({ style: "glossy 3D render", scene: "A bank vault door held shut by a single bent paper clip under cold blue light, a tiny figure looking up." }));
    const png = await (await import("sharp")).default({ create: { width: 1024, height: 1024, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
    const bodies: Record<string, unknown>[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: string, init?: { body?: string; headers?: Record<string, string> }) => {
      expect(String(u)).toBe("https://api.cloudflare.com/client/v4/accounts/acc123/ai/run/@cf/black-forest-labs/flux-1-schnell");
      expect(init?.headers?.Authorization).toBe("Bearer cf-token");
      const b = JSON.parse(init!.body!);
      bodies.push(b);
      if ("seed" in b) return new Response(JSON.stringify({ success: false, errors: [{ message: "AiError: Bad input: Error: Additional or unevaluated properties '/seed' at '/' not allowed (abc)" }] }), { status: 400 });
      return new Response(JSON.stringify({ success: true, result: { image: png.toString("base64") } }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const img = await withUser(me(), async () => ensurePostImage(await scheduledPost("linkedin")));
      expect(img).toMatchObject({ mime: "image/jpeg", credit: "AI illustration made for this post" });
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).not.toHaveProperty("seed");
      expect(bodies[1].prompt).toContain("paper clip");
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      delete process.env.CLOUDFLARE_API_TOKEN;
      resetEnvCache();
    }
  });
});
