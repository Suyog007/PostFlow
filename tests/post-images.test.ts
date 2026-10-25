import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { altText, cardUrl, drawPrompt, ensurePostImage, redrawPostImage, setImageDrawerForTests, setImageMakingForTests, verifyCard, wantsImage } from "../src/server/post-images";
import { withUser } from "../src/server/context";
import { publishDue } from "../src/server/publisher";
import { saveSettings, getSettings } from "../src/server/settings";
import { setPlatformClientForTests } from "../src/server/platforms/accounts";
import type { PublishOptions } from "../src/server/platforms/types";
import { GOOD_REVIEW, fakeLLM, me, resetDb } from "./helpers";

const POST = "GitLab fixed a bug that sat in its code for 12 years.\n\nAnyone could run code on an unpatched server, per The Register. Patching is the whole fix.\n\n#gitlab #security";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const SCENE = { style: "glossy 3D render", scene: "A cracked steel padlock on a dark server rack being welded shut by a small robotic arm, bright orange sparks, deep navy background, dramatic rim light." };

/** Pictures on, with the image model stubbed. Returns the prompts it was asked to draw. */
function drawing(result: Buffer | null = JPEG) {
  const prompts: string[] = [];
  setImageMakingForTests(true);
  setImageDrawerForTests(async (prompt) => {
    prompts.push(prompt);
    return result ? { data: result, mime: "image/jpeg" } : null;
  });
  return prompts;
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

  it("the image model is always told: no text, no logos", () => {
    const p = drawPrompt(SCENE);
    expect(p).toContain(SCENE.scene);
    expect(p).toContain("glossy 3D render");
    expect(p).toMatch(/No text, no letters, no numbers, no logos, no watermark/);
  });
});

describe("drawing the picture", () => {
  beforeEach(resetDb);

  it("asks the writer for a scene, draws it once, stores it, and counts it toward the daily limit", async () => {
    const prompts = drawing();
    const calls = fakeLLM((req) => (req.schemaName === "image_scene" ? SCENE : GOOD_REVIEW));
    const p = await scheduledPost();
    const img = await withUser(me(), () => ensurePostImage(p));
    expect(img).toMatchObject({ mime: "image/jpeg" });
    expect(calls.find((c) => c.schemaName === "image_scene")!.user).toContain("GitLab fixed a bug");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("cracked steel padlock");

    // Second time it comes from storage: no new scene, no new drawing.
    await withUser(me(), () => ensurePostImage(p));
    expect(prompts).toHaveLength(1);
    expect((await db().select().from(schema.llmCalls)).map((c) => c.task).sort()).toEqual(["draw_image", "image_scene"]);
  });

  it("a new picture replaces the old one and changes the link", async () => {
    const prompts = drawing();
    fakeLLM(() => SCENE);
    const p = await scheduledPost();
    await withUser(me(), () => ensurePostImage(p));
    setImageDrawerForTests(async () => ({ data: Buffer.from([0xff, 0xd8, 9]), mime: "image/jpeg" }));
    const again = await withUser(me(), () => redrawPostImage(p));
    expect(again!.data).toEqual(Buffer.from([0xff, 0xd8, 9]));
    expect(await db().select().from(schema.postImages)).toHaveLength(1);
    const after = (await db().select().from(schema.posts).where(eq(schema.posts.id, p.id)))[0];
    expect(cardUrl(after)).not.toBe(cardUrl(p));
    expect(prompts).toHaveLength(1);
  });

  it("serves the stored picture on a signed link and refuses anything else", async () => {
    drawing();
    fakeLLM(() => SCENE);
    const { GET } = await import("../src/app/api/cards/[id]/route");
    const p = await scheduledPost();
    const res = await GET(new Request(cardUrl(p)), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(JPEG);

    const bad = await GET(new Request(`http://localhost/api/cards/${p.id}?v=1&s=nope`), { params: Promise.resolve({ id: p.id }) });
    expect(bad.status).toBe(404);
  });

  it("when the image model fails, nothing is stored and the link says so", async () => {
    drawing(null);
    fakeLLM(() => SCENE);
    const p = await scheduledPost();
    expect(await withUser(me(), () => ensurePostImage(p))).toBeNull();
    expect(await db().select().from(schema.postImages)).toHaveLength(0);
  });
});

describe("publishing with the picture", () => {
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

  it("attaches the picture, with the first line as its alt text", async () => {
    drawing();
    fakeLLM(() => SCENE);
    const calls = recordingClient();
    await duePost();
    expect((await publishDue({ now: NOW })).published).toBe(1);
    expect(calls[0].media).toHaveLength(1);
    expect(calls[0].media![0]).toMatchObject({ mime: "image/jpeg", alt: "GitLab fixed a bug that sat in its code for 12 years." });
  });

  it("still posts, as text only, when the picture cannot be made or the upload fails", async () => {
    drawing(null);
    fakeLLM(() => SCENE);
    let calls = recordingClient();
    const a = await duePost();
    await publishDue({ now: NOW });
    expect(calls[0].media).toBeUndefined();
    expect((await db().select().from(schema.posts).where(eq(schema.posts.id, a.id)))[0].status).toBe("published");

    await resetDb();
    drawing();
    fakeLLM(() => SCENE);
    calls = recordingClient((o) => (o.media?.length ? "X media upload failed (HTTP 400): bad image" : null));
    const b = await duePost();
    await publishDue({ now: NOW });
    expect(calls).toHaveLength(2);
    expect(calls[1].media).toBeUndefined();
    expect((await db().select().from(schema.posts).where(eq(schema.posts.id, b.id)))[0].status).toBe("published");
  });

  it("goes without a picture when pictures are off for the platform", async () => {
    const prompts = drawing();
    fakeLLM(() => SCENE);
    const calls = recordingClient();
    await duePost();
    await saveSettings({ images: { linkedin: true, x: false } });
    await publishDue({ now: NOW });
    expect(calls[0].media).toBeUndefined();
    expect(prompts).toHaveLength(0);
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

  it("New picture draws again and sends the post back with it; No picture switches it off", async () => {
    const { handleTelegramUpdate } = await import("../src/server/telegram-inbound");
    const { resetEnvCache } = await import("../src/server/env");
    drawing();
    fakeLLM(() => SCENE);
    const p = await scheduledPost();
    await withUser(me(), () => ensurePostImage(p));
    setImageDrawerForTests(async () => ({ data: Buffer.from([0xff, 0xd8, 7]), mime: "image/jpeg" }));

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
      const photo = sent.find((m) => m.method === "sendPhoto")!;
      expect(photo.body.caption).toMatch(/^🎨 New picture/);
      expect(JSON.stringify(photo.body.reply_markup)).toContain(`xi:${p.id}`);
      expect((await db().select().from(schema.postImages))[0].data).toEqual(Buffer.from([0xff, 0xd8, 7]));

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

describe("talking to Fireworks", () => {
  beforeEach(resetDb);

  it("tries the other request shapes when one is refused, and keeps Fireworks' words when all fail", async () => {
    const { resetEnvCache } = await import("../src/server/env");
    process.env.FIREWORKS_API_KEY = "fw-test";
    resetEnvCache();
    setImageMakingForTests(true);
    setImageDrawerForTests(null); // the real drawer, against a stubbed network
    fakeLLM(() => SCENE);
    const realFetch = globalThis.fetch;
    const asked: string[] = [];
    let works = true;
    globalThis.fetch = (async (u: string) => {
      asked.push(String(u));
      if (works && String(u).endsWith("/images/generations")) return new Response(JSON.stringify({ data: [{ b64_json: Buffer.alloc(2000, 0xff).toString("base64") }] }), { headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ error: "Model not found" }), { status: 404, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const p = await scheduledPost();
      const img = await withUser(me(), () => ensurePostImage(p));
      expect(img).toMatchObject({ mime: "image/jpeg" });
      expect(asked.some((u) => u.includes("/text_to_image"))).toBe(true);

      works = false;
      const q = await scheduledPost("linkedin");
      expect(await withUser(me(), () => ensurePostImage(q))).toBeNull();
      const failed = (await db().select().from(schema.llmCalls)).find((c) => c.task === "draw_image" && c.status === "error")!;
      expect(failed.error).toContain("Model not found");

      // Viewing it again soon after does not spend more calls; asking for a new picture does.
      const before = asked.length;
      expect(await withUser(me(), () => ensurePostImage(q))).toBeNull();
      expect(asked.length).toBe(before);
      await withUser(me(), () => redrawPostImage(q));
      expect(asked.length).toBeGreaterThan(before);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.FIREWORKS_API_KEY;
      resetEnvCache();
    }
  });
});
