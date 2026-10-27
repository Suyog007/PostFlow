import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { altText, cardUrl, ensurePostImage, logoCard, noPictureReason, redrawPostImage, setImageDownloadForTests, setImageMakingForTests, setLogoSearchForTests, verifyCard, wantsImage, type Logo } from "../src/server/post-images";
import { withUser } from "../src/server/context";
import { publishDue } from "../src/server/publisher";
import { saveSettings } from "../src/server/settings";
import { setPlatformClientForTests } from "../src/server/platforms/accounts";
import type { PublishOptions } from "../src/server/platforms/types";
import { GOOD_REVIEW, fakeLLM, me, resetDb } from "./helpers";

const POST = "Running Qwen on your own servers does not make it trustworthy.\n\nA sandbox test caught the model uploading a file to a cloud bucket, per the report.\n\n#ai #security";
const png = async (w: number, h: number, rgb: [number, number, number], alpha = 1) =>
  (await import("sharp")).default({ create: { width: w, height: h, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha } } }).png().toBuffer();
const logo = (n: number): Logo => ({ url: `https://upload.example/${n}.png`, source: `https://commons.wikimedia.org/wiki/File:Qwen_logo_${n}.svg`, credit: "Qwen logo via Wikimedia Commons (Public domain)", title: `Qwen logo ${n}.svg` });

/** Pictures on, with the subject model and Wikimedia Commons stubbed. Returns the subjects looked up. */
async function logos(found: (subject: string) => Logo[] = () => [logo(1), logo(2)], subject: string | null = "Qwen") {
  const asked: string[] = [];
  setImageMakingForTests(true);
  setLogoSearchForTests(async (q) => {
    asked.push(q);
    return found(q);
  });
  const img = await png(400, 120, [97, 92, 237]);
  setImageDownloadForTests(async () => img);
  const calls = fakeLLM((req) => (req.schemaName === "image_subject" ? { subject } : GOOD_REVIEW));
  return { asked, calls };
}

async function scheduledPost(platform = "x", text = POST) {
  const [p] = await db().insert(schema.posts).values({ userId: me(), platform, pillar: "news", text, status: "scheduled", scheduledAt: new Date(Date.now() + 3_600_000) }).returning();
  return p;
}

describe("picture basics", () => {
  it("alt text is the first line without hashtags or links", () => {
    expect(altText({ text: POST })).toBe("Running Qwen on your own servers does not make it trustworthy.");
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

  it("puts the logo on a 1200x675 card, white for dark logos and dark for white ones", async () => {
    const sharp = (await import("sharp")).default;
    const dark = await logoCard(await png(400, 120, [20, 30, 120]));
    const white = await logoCard(await png(400, 120, [255, 255, 255]));
    const corner = async (b: Buffer) => (await sharp(b).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer())[0];
    expect((await sharp(dark!.data).metadata()).width).toBe(1200);
    expect(await corner(dark!.data)).toBeGreaterThan(240);
    expect(await corner(white!.data)).toBeLessThan(40);
  });
});

describe("the logo of what the post is about", () => {
  beforeEach(resetDb);

  it("names the subject, takes its logo from Wikimedia Commons and stores it with the credit", async () => {
    const { asked, calls } = await logos();
    const p = await scheduledPost();
    const img = await withUser(me(), () => ensurePostImage(p));
    expect(img).toMatchObject({ mime: "image/jpeg", prompt: "Qwen", source: logo(1).source, credit: "Qwen logo via Wikimedia Commons (Public domain)" });
    expect(asked).toEqual(["Qwen"]);
    expect(calls.find((c) => c.schemaName === "image_subject")!.system).toMatch(/Return null for subject/);
    // Stored: the second view does not look again.
    await withUser(me(), () => ensurePostImage(p));
    expect(asked).toHaveLength(1);
  });

  it("a post about a general idea goes out as text, and is not asked about again on every view", async () => {
    const { asked, calls } = await logos(undefined, null);
    const p = await scheduledPost("linkedin", "Caching is remembering an answer so you do not work it out twice.");
    expect(await withUser(me(), () => ensurePostImage(p))).toBeNull();
    const row = (await db().select().from(schema.posts).where(eq(schema.posts.id, p.id)))[0];
    expect(noPictureReason(row)).toMatch(/general idea/);
    expect(await withUser(me(), () => ensurePostImage(row))).toBeNull();
    expect(calls.filter((c) => c.schemaName === "image_subject")).toHaveLength(1);
    expect(asked).toHaveLength(0);
  });

  it("when no logo is found, it goes out as text and says why", async () => {
    await logos(() => []);
    const p = await scheduledPost();
    expect(await withUser(me(), () => ensurePostImage(p))).toBeNull();
    expect(noPictureReason((await db().select().from(schema.posts).where(eq(schema.posts.id, p.id)))[0])).toMatch(/No Qwen logo found/);
  });

  it("Other logo takes the next one, and keeps the current one if there is no other", async () => {
    await logos(() => [logo(1), logo(2)]);
    const p = await scheduledPost();
    await withUser(me(), () => ensurePostImage(p));
    const again = await withUser(me(), () => redrawPostImage(p));
    expect(again!.source).toBe(logo(2).source);
    const after = (await db().select().from(schema.posts).where(eq(schema.posts.id, p.id)))[0];
    expect(cardUrl(after)).not.toBe(cardUrl(p));

    await logos(() => [logo(2)]);
    expect(await withUser(me(), () => redrawPostImage(after))).toBeNull();
    expect((await db().select().from(schema.postImages))[0].source).toBe(logo(2).source);
  });

  it("serves the stored logo card on a signed link and refuses anything else", async () => {
    await logos();
    const { GET } = await import("../src/app/api/cards/[id]/route");
    const p = await scheduledPost();
    const res = await GET(new Request(cardUrl(p)), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const bad = await GET(new Request(`http://localhost/api/cards/${p.id}?v=1&s=nope`), { params: Promise.resolve({ id: p.id }) });
    expect(bad.status).toBe(404);
  });

  it("reads Wikimedia Commons: only files named after the subject and called a logo, SVG first", async () => {
    setImageMakingForTests(true);
    setLogoSearchForTests(null); // the real Commons lookup, against a stubbed network
    const img = await png(400, 120, [97, 92, 237]);
    setImageDownloadForTests(async () => img);
    fakeLLM(() => ({ subject: "Qwen" }));
    const asked: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: string) => {
      asked.push(String(u));
      return new Response(
        JSON.stringify({
          query: {
            pages: {
              "1": { index: 1, title: "File:Alibaba headquarters.jpg", imageinfo: [{ thumburl: "https://up/hq.jpg", descriptionurl: "https://c/hq" }] },
              "2": { index: 2, title: "File:Qwen logo.png", imageinfo: [{ thumburl: "https://up/qwen.png", descriptionurl: "https://c/qwen-png", extmetadata: { LicenseShortName: { value: "Public domain" } } }] },
              "3": { index: 3, title: "File:Qwen logo.svg", imageinfo: [{ thumburl: "https://up/qwen-svg.png", descriptionurl: "https://c/qwen-svg", extmetadata: { LicenseShortName: { value: "Public domain" } } }] },
            },
          },
        }),
      );
    }) as typeof fetch;
    try {
      const out = await withUser(me(), async () => ensurePostImage(await scheduledPost()));
      expect(out).toMatchObject({ source: "https://c/qwen-svg", credit: "Qwen logo via Wikimedia Commons (Public domain)" });
      const q = new URL(asked[0]);
      expect(q.hostname).toBe("commons.wikimedia.org");
      expect(q.searchParams.get("gsrsearch")).toBe("Qwen logo");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("publishing with the logo", () => {
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

  it("attaches the logo card, with the first line as its alt text", async () => {
    await logos();
    const calls = recordingClient();
    await duePost();
    expect((await publishDue({ now: NOW })).published).toBe(1);
    expect(calls[0].media![0]).toMatchObject({ mime: "image/jpeg", alt: "Running Qwen on your own servers does not make it trustworthy." });
  });

  it("posts as text when there is no logo, or when the upload fails", async () => {
    await logos(() => []);
    let calls = recordingClient();
    const a = await duePost();
    await publishDue({ now: NOW });
    expect(calls[0].media).toBeUndefined();
    expect((await db().select().from(schema.posts).where(eq(schema.posts.id, a.id)))[0].status).toBe("published");

    await resetDb();
    await logos();
    calls = recordingClient((o) => (o.media?.length ? "X media upload failed (HTTP 400): bad image" : null));
    const b = await duePost();
    await publishDue({ now: NOW });
    expect(calls).toHaveLength(2);
    expect(calls[1].media).toBeUndefined();
    expect((await db().select().from(schema.posts).where(eq(schema.posts.id, b.id)))[0].status).toBe("published");
  });

  it("goes without when pictures are off for the platform", async () => {
    const { asked } = await logos();
    const calls = recordingClient();
    await duePost();
    await saveSettings({ images: { linkedin: true, x: false } });
    await publishDue({ now: NOW });
    expect(calls[0].media).toBeUndefined();
    expect(asked).toHaveLength(0);
  });
});

describe("logo buttons in Telegram", () => {
  beforeEach(resetDb);

  it("Other logo sends the post back with the next one; No logo switches it off", async () => {
    const { handleTelegramUpdate } = await import("../src/server/telegram-inbound");
    const { resetEnvCache } = await import("../src/server/env");
    await logos();
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
      expect(msg.body.caption).toMatch(/^🔁 Other logo/);
      expect(JSON.stringify(msg.body.reply_markup)).toContain(`xi:${p.id}`);
      expect((await db().select().from(schema.postImages))[0].source).toBe(logo(2).source);
      await handleTelegramUpdate({ callback_query: { id: "2", data: `xi:${p.id}`, message: { chat: { id: 42 } } } });
      expect((await db().select().from(schema.posts).where(eq(schema.posts.id, p.id)))[0].review).toMatchObject({ noImage: true });
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.TELEGRAM_BOT_TOKEN;
      resetEnvCache();
    }
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
