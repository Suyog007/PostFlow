// Pictures for posts. The writer model reads the post and describes one striking scene; an image
// model (FLUX on Fireworks) draws it. No words, names or logos in the picture: just the idea.
// The picture is stored once per post, attached when the post is published, and shown in Telegram
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
export type PostImage = { data: Buffer; mime: string; prompt: string };

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

The goal: make someone stop scrolling, and make the topic clear at a glance.

Rules:
- Show a concrete visual metaphor or scene for the post's core idea, not a generic "technology" background. Examples: a security fix → a cracked steel padlock being welded shut with bright sparks; a slow database query → a tiny figure lost in an endless library while a small glowing index drawer sits unused; an AI model stopping training on the live web → a robot closing a window onto a stormy, chaotic city and reading from a calm stack of archived books.
- One clear subject, with room around it. Bold colour, dramatic lighting, strong contrast so it reads on a phone.
- Never any text, letters, numbers, words, signs, captions, code, screens with writing, logos, brand marks or watermarks. Company and product names must not appear; show the idea instead.
- No real or recognisable people. Figures, if any, are small or stylised.
- Pick the style that fits: "glossy 3D render", "isometric 3D diorama", "bold flat vector illustration" or "cinematic photograph".
- The scene is 35 to 80 words in plain English describing what is seen. Do not mention the post, social media or the author.`;

const Scene = z.object({
  style: z.string().min(3).max(60),
  scene: z.string().min(40).max(700),
});

/** The image model's prompt: the scene, its style, and the house rules repeated so the model keeps to them. */
export function drawPrompt(scene: z.infer<typeof Scene>): string {
  return `${scene.scene.trim()} Style: ${scene.style.trim()}, high detail, clean composition, wide 16:9 frame. No text, no letters, no numbers, no logos, no watermark.`;
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

type Drawn = { data: Buffer; mime: string };
type DrawResult = Drawn | { error: string };

/** Reads an image out of a Fireworks reply: raw image bytes, or JSON carrying base64. */
async function imageFrom(res: Response): Promise<Drawn | null> {
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (type.startsWith("image/")) return { data: Buffer.from(await res.arrayBuffer()), mime: type };
  const json = (await res.json().catch(() => null)) as { base64?: string[] | string; image?: string; data?: { b64_json?: string }[] } | null;
  const b64 = (Array.isArray(json?.base64) ? json.base64[0] : json?.base64) ?? json?.image ?? json?.data?.[0]?.b64_json;
  if (!b64) return null;
  const data = Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ""), "base64");
  const mime = data[0] === 0x89 ? "image/png" : data[0] === 0x52 ? "image/webp" : "image/jpeg";
  return data.length > 1000 ? { data, mime } : null;
}

/**
 * FLUX on Fireworks, 16:9. Fireworks has offered its image models under a few request shapes and
 * model names, so each is tried in turn. Returns the image, or what Fireworks said when none worked.
 */
async function fireworksDraw(prompt: string): Promise<DrawResult> {
  const key = env().FIREWORKS_API_KEY;
  if (!key) return { error: "FIREWORKS_API_KEY is not set." };
  const base = env().FIREWORKS_BASE_URL.replace(/\/$/, "");
  const model = env().FIREWORKS_IMAGE_MODEL;
  const names = [...new Set([model, model.replace(/-fp8$/, ""), "flux-1-schnell-fp8", "flux-1-schnell"])];
  const tries: { url: string; body: Record<string, unknown> }[] = [
    ...names.map((m) => ({ url: `${base}/workflows/accounts/fireworks/models/${m}/text_to_image`, body: { prompt, aspect_ratio: "16:9", seed: 0 } })),
    ...names.map((m) => ({ url: `${base}/images/generations`, body: { model: `accounts/fireworks/models/${m}`, prompt, n: 1, size: "1344x768", response_format: "b64_json" } })),
  ];
  const errors: string[] = [];
  for (const t of tries) {
    const res = await fetch(t.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: t.url.endsWith("text_to_image") ? "image/jpeg" : "application/json" },
      body: JSON.stringify(t.body),
      signal: AbortSignal.timeout(60_000),
    }).catch((e: Error) => {
      errors.push(`${t.url.replace(base, "")}: ${e.message}`);
      return null;
    });
    if (!res) continue;
    if (res.ok) {
      const img = await imageFrom(res);
      if (img) return img;
      errors.push(`${t.url.replace(base, "")}: HTTP ${res.status} without an image`);
      continue;
    }
    const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
    errors.push(`${t.url.replace(base, "")} ${String(t.body.model ?? "")}: HTTP ${res.status} ${body}`);
    // A bad key or no credit will not be fixed by another request shape.
    if (res.status === 401 || res.status === 402) break;
  }
  const error = errors.join(" || ").slice(0, 1500);
  log.warn("image_draw_failed", { error });
  return { error };
}

let draw: (prompt: string) => Promise<DrawResult | null> = fireworksDraw;
/** Tests swap the image model for a stub. */
export function setImageDrawerForTests(fn: ((prompt: string) => Promise<DrawResult | null>) | null) {
  draw = fn ?? fireworksDraw;
}

/** Scene, then picture. Recorded with the model calls so it counts toward the daily limit. */
async function makeImage(post: PostLike): Promise<PostImage | null> {
  const prompt = await describeScene(post);
  const out = await draw(prompt);
  const img = out && "data" in out ? out : null;
  const error = img ? null : out && "error" in out ? out.error : "No image came back.";
  await db().insert(schema.llmCalls).values({ userId: post.userId, task: "draw_image", model: env().FIREWORKS_IMAGE_MODEL, status: img ? "ok" : "error", error });
  return img ? { ...img, prompt } : null;
}

let maker: ((post: PostLike) => Promise<PostImage | null>) | null = makeImage;
/** Tests that are not about pictures switch making them off (null), so no model calls are spent on them. */
export function setImageMakingForTests(on: boolean) {
  maker = on ? makeImage : null;
}

/** The post's stored picture, made now if there is none yet. Null when it cannot be made. Never throws. */
export async function ensurePostImage(post: PostLike, opts: { force?: boolean } = {}): Promise<PostImage | null> {
  try {
    const have = await db().query.postImages.findFirst({ where: eq(schema.postImages.postId, post.id) });
    if (have) return { data: have.data, mime: have.mime, prompt: have.prompt };
    if (!maker) return null;
    // After a failed drawing, wait a while before trying again on its own, so a broken image service does not eat the daily limit.
    if (!opts.force) {
      const failed = await db().query.llmCalls.findFirst({
        where: and(eq(schema.llmCalls.userId, post.userId), eq(schema.llmCalls.task, "draw_image"), eq(schema.llmCalls.status, "error"), gt(schema.llmCalls.createdAt, new Date(Date.now() - 10 * 60_000))),
      });
      if (failed) return null;
    }
    const img = await maker(post);
    if (!img) return null;
    await db().insert(schema.postImages).values({ postId: post.id, userId: post.userId, ...img }).onConflictDoNothing();
    return img;
  } catch (err) {
    log.warn("post_image_failed", { postId: post.id, error: (err as Error).message });
    return null;
  }
}

/** Throws away the post's picture and draws a new one. The post's updatedAt moves so links and caches refresh. */
export async function redrawPostImage(post: PostLike): Promise<PostImage | null> {
  await db().delete(schema.postImages).where(eq(schema.postImages.postId, post.id));
  const updatedAt = new Date();
  await db().update(schema.posts).set({ updatedAt }).where(eq(schema.posts.id, post.id));
  return ensurePostImage({ ...post, updatedAt }, { force: true });
}
