// Pictures for posts. When Cloudflare Workers AI is set up, the writer model describes a scene for the
// post's point and FLUX draws it. Otherwise (or if that fails) the writer picks photo searches and the
// first good photo from a free photo library (Pexels, or public-domain photos on Openverse) is used.
// Neither needs credit in the post, unlike pictures taken from news sites.
// The photo is stored once per post, attached when the post is published, and shown in Telegram
// and the app through the signed /api/cards/[id] link.

import crypto from "node:crypto";
import { z } from "zod";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "./db/client";
import { env } from "./env";
import { runTask } from "./llm";
import { log } from "./log";
import type { Settings } from "./settings";

type PostLike = { id: string; userId: string; platform: string; pillar: string; text: string; updatedAt: Date; review: unknown };
export type PostImage = { data: Buffer; mime: string; prompt: string; source?: string | null; credit?: string | null };

/** The first line of the post, without hashtags or links: the picture's alt text. */
export function altText(post: Pick<PostLike, "text">): string {
  const first =
    post.text
      .split("\n")
      .map((l) =>
        l
          .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "")
          .replace(/https?:\/\/\S+/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .find(Boolean) ?? "";
  return first.length > 300 ? `${first.slice(0, 297)}…` : first;
}

function sign(id: string, v: number) {
  const secret = env().SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set, so image links cannot be signed.");
  return crypto.createHmac("sha256", secret).update(`card:${id}:${v}`).digest("hex").slice(0, 32);
}

/** A signed, cacheable URL for the post's picture. A new picture or a changed post (its updatedAt) gives a new URL. */
export function cardUrl(post: Pick<PostLike, "id" | "updatedAt">): string {
  const v = post.updatedAt.getTime();
  return `${env().APP_URL.replace(/\/$/, "")}/api/cards/${post.id}?v=${v}&s=${sign(post.id, v)}`;
}

export function verifyCard(id: string, v: string | null, s: string | null): boolean {
  if (!v || !s || !/^\d{10,16}$/.test(v)) return false;
  const want = Buffer.from(sign(id, Number(v)));
  const got = Buffer.from(s);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** Whether a post goes out with a picture: on for the platform in Settings, and not switched off for this post. */
export function wantsImage(post: Pick<PostLike, "platform" | "review">, s: Pick<Settings, "images">): boolean {
  if ((post.review as { noImage?: boolean } | null)?.noImage) return false;
  return !!s.images[post.platform as "x" | "linkedin"];
}

const SCENE_SYSTEM = `You are the art director for a software engineer's LinkedIn and X posts. Read the post and describe ONE image to go with it, for an image model to draw.

The goal: make someone stop scrolling, and make this specific post's point clear at a glance.

Rules:
- Show the post's specific point as a concrete scene or visual metaphor. Not a generic symbol for the topic: no lone padlock, key, shield, code screen, glowing brain or circuit board. Ask "what is surprising or at stake here?" and show that. Examples: certificates issued with tiny 4-bit keys → a bank vault door held shut by a single paper clip; long-lived API keys nobody rotates → a dusty old key hanging on a hook marked by cobwebs, beside a busy modern office; a slow query with no index → a librarian buried under piles of books while a small card catalogue sits unused; an AI model trained on cached copies instead of the live web → a robot reading in a quiet archive while a storm rages outside the window.
- One clear subject in the centre, with space above and below (the picture is cropped to a wide frame). Bold colour, dramatic lighting, strong contrast so it reads on a phone.
- Never any text, letters, numbers, words, signs, captions, code, screens with writing, logos or watermarks. Company and product names must not appear; show the idea instead.
- No real or recognisable people. Figures, if any, are small or stylised.
- Pick the style that fits: "glossy 3D render", "isometric 3D diorama", "bold flat vector illustration" or "cinematic photograph".
- The scene is 35 to 80 words in plain English describing what is seen. Do not mention the post, social media or the author.`;

const Scene = z.object({
  style: z.string().min(3).max(60),
  scene: z.string().min(40).max(700),
});

/** The image model's prompt: the scene, its style, and the house rules repeated so the model keeps to them. */
export function drawPrompt(scene: z.infer<typeof Scene>): string {
  return `${scene.scene.trim()} Style: ${scene.style.trim()}, high detail, clean composition, subject centred. No text, no letters, no numbers, no logos, no watermark.`;
}

async function describeScene(post: PostLike): Promise<string> {
  const kind = post.pillar === "learning" ? "a short lesson" : post.pillar === "own_work" ? "something the author built" : "a news story";
  const out = await runTask({
    task: "image_scene",
    role: "writer",
    system: SCENE_SYSTEM,
    user: `The post (${kind}, for ${post.platform === "x" ? "X" : "LinkedIn"}):\n\n${post.text}`,
    output: Scene,
    maxTokens: 1200,
    temperature: 0.9,
  });
  return drawPrompt(out);
}

/** FLUX schnell on Cloudflare Workers AI: free for about a hundred pictures a day. Returns JPEG/PNG bytes. */
async function cloudflareDraw(prompt: string, seed: number): Promise<Buffer> {
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = env();
  // Only the prompt is required. Extra settings the model does not accept are dropped and the call retried.
  const body: Record<string, unknown> = { prompt: prompt.slice(0, 2000), steps: 6, seed };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && type.startsWith("image/")) return Buffer.from(await res.arrayBuffer());
    const json = (await res.json().catch(() => null)) as { result?: { image?: string }; errors?: { message?: string }[] } | null;
    if (res.ok && json?.result?.image) return Buffer.from(json.result.image, "base64");
    const msg = json?.errors?.map((e) => e.message).join("; ") ?? "no image";
    const extra = msg.match(/properties '\/(\w+)'/)?.[1];
    if (res.status === 400 && extra && extra !== "prompt" && extra in body) {
      delete body[extra];
      continue;
    }
    throw new Error(`Cloudflare HTTP ${res.status}: ${msg}`.slice(0, 300));
  }
  throw new Error("Cloudflare did not accept the request.");
}

let aiOverride: ((prompt: string, seed: number) => Promise<Buffer>) | null | undefined;
/** Tests swap the image model for a stub (or null for none). */
export function setAiDrawerForTests(fn: ((prompt: string, seed: number) => Promise<Buffer>) | null | undefined) {
  aiOverride = fn;
}
function aiDrawer() {
  if (aiOverride !== undefined) return aiOverride;
  return env().CLOUDFLARE_ACCOUNT_ID && env().CLOUDFLARE_API_TOKEN ? cloudflareDraw : null;
}

/** Every picture is cut to 1200x675 and saved as a compact JPEG, so it loads fast everywhere and both platforms accept it. */
export async function shrink(data: Buffer): Promise<{ data: Buffer; mime: string } | null> {
  try {
    const { default: sharp } = await import("sharp");
    const out = await sharp(data).rotate().resize(1200, 675, { fit: "cover", position: "attention" }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    return { data: out, mime: "image/jpeg" };
  } catch (err) {
    log.warn("image_shrink_failed", { error: (err as Error).message });
    return data.length < 5_000_000 ? { data, mime: data[0] === 0x89 ? "image/png" : "image/jpeg" } : null;
  }
}

const SEARCH_SYSTEM = `You pick photo searches for a software engineer's LinkedIn and X posts. A free photo library will be searched with them, and the first good photo goes with the post.

Rules:
- Give 3 searches, most specific first. Each is 2 to 4 plain words naming a scene you can photograph that fits THIS post's point, not just its topic.
- Avoid the generic picks everyone uses: padlock, key, lock, shield, hacker in hoodie, code on screen, binary, circuit board, glowing brain. Think of a real-world scene instead. Certificates with weak keys → "bank vault door", "cracked safe"; old API keys nobody rotates → "dusty old keys", "rusty gate"; a slow database → "library stacks", "traffic jam"; AI trained on old copies → "archive boxes", "old newspapers".
- No brand, company, product or person names (the library will not have them), and no abstract words like "innovation" or "future".`;

const Searches = z.object({ queries: z.array(z.string().min(2).max(40)).min(1).max(4) });

async function photoSearches(post: PostLike): Promise<string[]> {
  const kind = post.pillar === "learning" ? "a short lesson" : post.pillar === "own_work" ? "something the author built" : "a news story";
  const out = await runTask({
    task: "image_search",
    role: "writer",
    system: SEARCH_SYSTEM,
    user: `The post (${kind}, for ${post.platform === "x" ? "X" : "LinkedIn"}):\n\n${post.text}`,
    output: Searches,
    maxTokens: 800,
    temperature: 0.5,
  });
  return [...new Set(out.queries.map((q) => q.trim().toLowerCase()).filter(Boolean))].slice(0, 3);
}

export type Photo = { url: string; source: string; credit: string };

/** Pexels: good everyday and tech photos, free to use without credit. Needs a free PEXELS_API_KEY. */
async function pexels(query: string): Promise<Photo[]> {
  const key = env().PEXELS_API_KEY;
  if (!key) return [];
  const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=landscape&per_page=15`, { headers: { Authorization: key }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Pexels HTTP ${res.status}`);
  const json = (await res.json()) as { photos?: { url: string; photographer?: string; src?: { landscape?: string; large2x?: string; large?: string } }[] };
  return (json.photos ?? []).flatMap((p) => {
    const url = p.src?.landscape ?? p.src?.large2x ?? p.src?.large;
    return url ? [{ url, source: p.url, credit: `${p.photographer ?? "Unknown"} on Pexels` }] : [];
  });
}

/** Openverse: openly licensed photos. Only public-domain ones (CC0 / PDM), which need no credit. No key needed. */
async function openverse(query: string): Promise<Photo[]> {
  const q = new URLSearchParams({ q: query, license: "cc0,pdm", mature: "false", page_size: "20" });
  const res = await fetch(`https://api.openverse.org/v1/images/?${q}`, { headers: { "User-Agent": "PostFlow/1.0 (+https://postfloow.netlify.app)" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Openverse HTTP ${res.status}`);
  const json = (await res.json()) as { results?: { url?: string; foreign_landing_url?: string; creator?: string; source?: string }[] };
  return (json.results ?? []).flatMap((r) => (r.url ? [{ url: r.url, source: r.foreign_landing_url ?? r.url, credit: `${r.creator ?? "Unknown"} via Openverse (public domain)` }] : []));
}

let searchers: ((query: string) => Promise<Photo[]>)[] = [pexels, openverse];
/** Tests swap the photo libraries for a stub. */
export function setPhotoSearchForTests(fn: ((query: string) => Promise<Photo[]>) | null) {
  searchers = fn ? [fn] : [pexels, openverse];
}

/** Downloads a photo of a sensible size. Any image format: it is turned into a JPEG afterwards. */
async function download(url: string): Promise<{ data: Buffer; mime: string } | null> {
  const res = await fetch(url, { headers: { "User-Agent": "PostFlow/1.0 (+https://postfloow.netlify.app)" }, signal: AbortSignal.timeout(20_000), redirect: "follow" }).catch(() => null);
  if (!res?.ok) return null;
  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!mime.startsWith("image/") || mime === "image/svg+xml") return null;
  const data = Buffer.from(await res.arrayBuffer());
  return data.length > 10_000 && data.length < 25_000_000 ? { data, mime } : null;
}

let fetchPhoto: (url: string) => Promise<{ data: Buffer; mime: string } | null> = download;
export function setPhotoDownloadForTests(fn: ((url: string) => Promise<{ data: Buffer; mime: string } | null>) | null) {
  fetchPhoto = fn ?? download;
}

/**
 * Searches, then the first photo that downloads and was not used before. Recorded with the model
 * calls so failures are visible and a broken library is not retried on every view.
 */
async function makeImage(post: PostLike, avoid: string[] = []): Promise<PostImage | null> {
  const errors: string[] = [];
  // An illustration made for this post's point, when an image model is set up.
  const ai = aiDrawer();
  if (ai) {
    try {
      const prompt = await describeScene(post);
      const seed = Math.floor(Math.random() * 1_000_000_000);
      const img = await shrink(await ai(prompt, seed));
      if (img) {
        await db().insert(schema.llmCalls).values({ userId: post.userId, task: "find_image", model: "flux-1-schnell", status: "ok" });
        return { ...img, prompt, source: `ai:${seed}`, credit: "AI illustration made for this post" };
      }
    } catch (err) {
      errors.push(`illustration: ${(err as Error).message}`);
      log.warn("image_draw_failed", { postId: post.id, error: (err as Error).message });
    }
  }
  // Otherwise a free-licence photo.
  const queries = await photoSearches(post);
  const used = new Set([...avoid, ...(await db().select({ s: schema.postImages.source }).from(schema.postImages).where(eq(schema.postImages.userId, post.userId))).map((r) => r.s ?? "")]);
  for (const query of queries) {
    for (const search of searchers) {
      const found = await search(query).catch((e: Error) => {
        errors.push(`${query}: ${e.message}`);
        return [] as Photo[];
      });
      for (const photo of found.filter((f) => !used.has(f.source)).slice(0, 4)) {
        const got = await fetchPhoto(photo.url);
        const img = got && (await shrink(got.data));
        if (!img) continue;
        await db().insert(schema.llmCalls).values({ userId: post.userId, task: "find_image", model: "photo-search", status: "ok" });
        return { ...img, prompt: query, source: photo.source, credit: photo.credit };
      }
    }
  }
  const error = (errors.length ? errors.join(" || ") : `No usable photo for: ${queries.join(", ")}`).slice(0, 1500);
  log.warn("post_image_failed", { postId: post.id, error });
  await db().insert(schema.llmCalls).values({ userId: post.userId, task: "find_image", model: "photo-search", status: "error", error });
  return null;
}

let maker: ((post: PostLike, avoid?: string[]) => Promise<PostImage | null>) | null = makeImage;
/** Tests that are not about pictures switch finding them off, so no model calls are spent on them. */
export function setImageMakingForTests(on: boolean) {
  maker = on ? makeImage : null;
}

/** The post's stored picture, made now if there is none yet. Null when it cannot be made. Never throws. */
export async function ensurePostImage(post: PostLike, opts: { force?: boolean; avoid?: string[] } = {}): Promise<PostImage | null> {
  try {
    const have = await db().query.postImages.findFirst({ where: eq(schema.postImages.postId, post.id) });
    if (have) return { data: have.data, mime: have.mime, prompt: have.prompt, source: have.source, credit: have.credit };
    if (!maker) return null;
    // After a failed drawing, wait a while before trying again on its own, so a broken image service does not eat the daily limit.
    if (!opts.force) {
      const failed = await db().query.llmCalls.findFirst({
        where: and(eq(schema.llmCalls.userId, post.userId), eq(schema.llmCalls.task, "find_image"), eq(schema.llmCalls.status, "error"), gt(schema.llmCalls.createdAt, new Date(Date.now() - 10 * 60_000))),
      });
      if (failed) return null;
    }
    const img = await maker(post, opts.avoid);
    if (!img) return null;
    await db().insert(schema.postImages).values({ postId: post.id, userId: post.userId, ...img }).onConflictDoNothing();
    return img;
  } catch (err) {
    log.warn("post_image_failed", { postId: post.id, error: (err as Error).message });
    return null;
  }
}

/** Swaps the post's photo for a different one. The post's updatedAt moves so links and caches refresh. */
export async function redrawPostImage(post: PostLike): Promise<PostImage | null> {
  const old = await db().query.postImages.findFirst({ where: eq(schema.postImages.postId, post.id) });
  const avoid = old?.source ? [old.source] : [];
  // Find the new one first, so a failed search keeps the photo that was there.
  if (!maker) return null;
  const img = await maker(post, avoid).catch(() => null);
  if (!img) return null;
  await db().delete(schema.postImages).where(eq(schema.postImages.postId, post.id));
  await db().insert(schema.postImages).values({ postId: post.id, userId: post.userId, ...img });
  await db().update(schema.posts).set({ updatedAt: new Date() }).where(eq(schema.posts.id, post.id));
  return img;
}
