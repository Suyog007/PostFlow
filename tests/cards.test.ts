import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { cardContent, cardUrl, setCardLoaderForTests, verifyCard, wantsImage } from "../src/server/cards";
import { publishDue } from "../src/server/publisher";
import { saveSettings, getSettings } from "../src/server/settings";
import { setPlatformClientForTests } from "../src/server/platforms/accounts";
import type { PublishOptions } from "../src/server/platforms/types";
import { GOOD_REVIEW, fakeLLM, me, resetDb } from "./helpers";

const POST = "GitLab fixed a bug that sat in its code for 12 years.\n\nAnyone could run code on an unpatched server, per The Register. Patching is the whole fix.\n\n#gitlab #security";

describe("what the card says", () => {
  it("uses the hook and the next sentence, without hashtags, and labels the kind of post", () => {
    const base = { id: "00000000-0000-4000-8000-000000000001", platform: "linkedin", updatedAt: new Date(), review: {} };
    const c = cardContent({ ...base, pillar: "news", text: POST }, { name: "Suyog Adhikari", role: "Senior Software Engineer" });
    expect(c).toMatchObject({ tag: "News", tone: "news", hook: "GitLab fixed a bug that sat in its code for 12 years.", sub: "Anyone could run code on an unpatched server, per The Register.", name: "Suyog Adhikari" });
    expect(JSON.stringify(c)).not.toContain("#");
    expect(cardContent({ ...base, pillar: "learning", text: "An index is a shortcut.\nLike a book's index." }, { name: "", role: "" })).toMatchObject({ tag: "Lesson", tone: "lesson" });
    expect(cardContent({ ...base, pillar: "news", text: POST, review: { move: "explain" } }, { name: "", role: "" }).tag).toBe("Heads-up");
    const long = cardContent({ ...base, pillar: "news", text: "word ".repeat(80) }, { name: "", role: "" });
    expect(long.hook.length).toBeLessThanOrEqual(151);
    expect(long.hook.endsWith("…")).toBe(true);
  });

  it("only signed links render, and a changed post gets a new link", () => {
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

describe("the card image", () => {
  beforeEach(resetDb);

  it("renders a 1200x675 PNG for a signed link and refuses anything else", async () => {
    const { GET } = await import("../src/app/api/cards/[id]/route");
    await saveSettings({ profile: { ...(await getSettings()).profile, name: "Suyog Adhikari", role: "Senior Software Engineer" } });
    const [p] = await db().insert(schema.posts).values({ userId: me(), platform: "linkedin", pillar: "news", text: POST, status: "scheduled", scheduledAt: new Date(Date.now() + 3_600_000) }).returning();
    const res = await GET(new Request(cardUrl(p)), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const png = Buffer.from(await res.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(675);

    const bad = await GET(new Request(`http://localhost/api/cards/${p.id}?v=1&s=nope`), { params: Promise.resolve({ id: p.id }) });
    expect(bad.status).toBe(404);
  }, 60_000);
});

describe("publishing with the card", () => {
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

  it("attaches the card, with the hook as its alt text", async () => {
    setCardLoaderForTests(async () => Buffer.from("png-bytes"));
    const calls = recordingClient();
    await duePost();
    expect((await publishDue({ now: NOW })).published).toBe(1);
    expect(calls[0].media).toHaveLength(1);
    expect(calls[0].media![0]).toMatchObject({ mime: "image/png", alt: "GitLab fixed a bug that sat in its code for 12 years." });
  });

  it("still posts, as text only, when the image cannot be made or the upload fails", async () => {
    setCardLoaderForTests(async () => null);
    let calls = recordingClient();
    const a = await duePost();
    await publishDue({ now: NOW });
    expect(calls[0].media).toBeUndefined();
    expect((await db().select().from(schema.posts).where(eq(schema.posts.id, a.id)))[0].status).toBe("published");

    await resetDb();
    setCardLoaderForTests(async () => Buffer.from("png-bytes"));
    calls = recordingClient((o) => (o.media?.length ? "X media upload failed (HTTP 400): bad image" : null));
    const b = await duePost();
    await publishDue({ now: NOW });
    expect(calls).toHaveLength(2);
    expect(calls[1].media).toBeUndefined();
    expect((await db().select().from(schema.posts).where(eq(schema.posts.id, b.id)))[0].status).toBe("published");
  });

  it("goes without the card when images are off for the platform", async () => {
    setCardLoaderForTests(async () => Buffer.from("png-bytes"));
    const calls = recordingClient();
    await duePost();
    await saveSettings({ images: { linkedin: true, x: false } });
    await publishDue({ now: NOW });
    expect(calls[0].media).toBeUndefined();
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
