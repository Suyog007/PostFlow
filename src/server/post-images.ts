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

const SCENE_SYSTEM = `You are the art director for a software engineer's LinkedIn and X posts. Read the post and describe ONE simple image to go with it. Every picture is drawn in the same calm, minimal house style, so you only choose WHAT is shown.

The goal: someone glancing at it on a phone gets the post's point, or is curious enough to read it.

Rules:
- Show the post's specific point as one simple visual metaphor made of everyday objects. Not a generic symbol for the topic: no lone padlock, key, shield, code screen, glowing brain, circuit board, robot or server rack. Ask "what is surprising or at stake here?" and show that.
  Examples: certificates issued with tiny 4-bit keys → a huge vault door held shut by one small paper clip; long-lived API keys nobody rotates → one old key covered in cobwebs on a clean hook; a slow query with no index → a tall messy pile of books next to a small, tidy card drawer; a page rebuilt in the background while visitors still get the old one (ISR) → a baker sliding a fresh loaf onto a shelf behind one already on display.
- At most TWO objects and nothing else. No crowds, no busy backgrounds, no little extra details. Simple shapes the eye reads in one second.
- Never any text, letters, numbers, labels, tags, signs, captions, screens, documents with writing, logos or watermarks. Never write "labeled", "reading", "marked" or put words in quotes: show the idea with the objects themselves.
- No people, faces or hands.
- One or two sentences, 15 to 40 words, describing only the objects, what they are doing and where they sit. No style words, no lighting, no camera terms (the house style adds those).`;

const Scene = z.object({ scene: z.string().min(20).max(500) });

/** One look for every picture, so the feed is recognisable and the model never draws busy scenes. */
const HOUSE_STYLE =
  "Minimal editorial 3D illustration, smooth matte clay-like materials, rounded simple shapes, plain softly lit studio background in one muted colour, one bold accent colour, soft shadows, lots of empty space, calm and premium, wide 16:9 composition with the subject in the centre. No text, no letters, no numbers, no labels, no signs, no logos, no watermark, no people.";

/** The scene without anything that invites the model to draw writing (quoted words, "labeled ...", "a sign saying ..."). */
export function cleanScene(scene: string): string {
  const LABEL = "(?:labell?ed|marked|reading|saying|that says|with the words?|inscribed|stamped)";
  return scene
    .replace(new RegExp(`,?\\s*\\b${LABEL}\\s*["“‘][^"”’]{0,40}["”’]`, "gi"), "")
    .replace(/["“‘][^"”’]{1,40}["”’]/g, "")
    .replace(new RegExp(`,?\\s*\\b${LABEL}\\b(?:\\s+[^\\s,.;]+){0,4}(?=[,.;]|$)`, "gi"), "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .trim();
}

/** The image model's prompt: the cleaned scene, then the house style. */
export function drawPrompt(scene: { scene: string }): string {
  return `${cleanScene(scene.scene)} ${HOUSE_STYLE}`;
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
    temperature: 0.8,
  });
  return drawPrompt(out);
}

const CF_RUN = (account: string, model: string) => `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/black-forest-labs/${model}`;

async function imageFromCloudflare(res: Response): Promise<Buffer | { error: string }> {
  const type = res.headers.get("content-type") ?? "";
  if (res.ok && type.startsWith("image/")) return Buffer.from(await res.arrayBuffer());
  const json = (await res.json().catch(() => null)) as { result?: { image?: string }; errors?: { message?: string }[] } | null;
  if (res.ok && json?.result?.image) return Buffer.from(json.result.image, "base64");
  return { error: `HTTP ${res.status}: ${json?.errors?.map((e) => e.message).join("; ") ?? "no image"}` };
}

/**
 * Cloudflare Workers AI. FLUX.2 [klein] 9B first: newer and much better at following the scene, drawn
 * natively at 16:9. It uses more of the free daily allowance (roughly 7 pictures a day), so when it
 * refuses or the allowance is used up, FLUX.1 [schnell] (roughly 100 a day) draws it instead.
 */
async function cloudflareDraw(prompt: string, seed: number): Promise<Buffer> {
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = env();
  const auth = { Authorization: `Bearer ${token}` };
  const errors: string[] = [];

  // FLUX.2 models take multipart form data, even for a prompt alone.
  const form = new FormData();
  form.append("prompt", prompt.slice(0, 2000));
  form.append("width", "1280");
  form.append("height", "720");
  form.append("seed", String(seed));
  const klein = await fetch(CF_RUN(account!, "flux-2-klein-9b"), { method: "POST", headers: auth, body: form, signal: AbortSignal.timeout(45_000) }).catch((e: Error) => e);
  if (klein instanceof Error) errors.push(`klein: ${klein.message}`);
  else {
    const out = await imageFromCloudflare(klein);
    if (Buffer.isBuffer(out)) return out;
    errors.push(`klein ${out.error}`);
  }

  // FLUX.1 schnell takes JSON with the prompt and steps only (it refuses seed and size).
  const body: Record<string, unknown> = { prompt: prompt.slice(0, 2000), steps: 8 };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(CF_RUN(account!, "flux-1-schnell"), { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
    const out = await imageFromCloudflare(res);
    if (Buffer.isBuffer(out)) return out;
    const extra = out.error.match(/properties '\/(\w+)'/)?.[1];
    if (res.status === 400 && extra && extra !== "prompt" && extra in body) {
      delete body[extra];
      continue;
    }
    errors.push(`schnell ${out.error}`);
    break;
  }
  throw new Error(`Cloudflare: ${errors.join(" || ")}`.slice(0, 600));
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
  const queries = await photoSearches(post).catch((err: Error) => {
    errors.push(`photo search: ${err.message}`);
    return [] as string[];
  });
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
