// Pictures for posts: the logo of what the post is about, when there is one.
// The writer model names the post's main subject (a company, product or project such as Qwen, OpenAI or
// Node.js). Its official logo is looked up on Wikimedia Commons and set on a clean card. A post about a
// general idea, or one whose logo cannot be found, goes out as text only: not every post needs a picture.
// The picture is stored once per post, attached when the post is published, and shown in Telegram and the
// app through the signed /api/cards/[id] link.

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

const SUBJECT_SYSTEM = `Read a LinkedIn or X post and name the ONE company, product, open-source project or programming technology it is mainly about, the way its own logo spells it: "Qwen", "OpenAI", "Node.js", "GitLab", "Stripe", "PostgreSQL", "Next.js".

Return null for subject when:
- the post is about a general idea, a habit or a lesson (caching, code review, technical debt) rather than one named thing;
- it is about several things equally (a comparison of three products);
- the thing has no logo of its own (TLS, "AI models", "databases", a vulnerability).
Pick the thing the story is about, not the publisher that reported it.`;

const Subject = z.object({ subject: z.string().min(1).max(60).nullable() });

async function imageSubject(post: PostLike): Promise<string | null> {
  const out = await runTask({ task: "image_subject", role: "writer", system: SUBJECT_SYSTEM, user: `The post:\n\n${post.text}`, output: Subject, maxTokens: 400, temperature: 0 });
  const name = out.subject?.trim();
  return name && !/^(null|none|n\/a)$/i.test(name) ? name : null;
}

export type Logo = { url: string; source: string; credit: string; title: string };

const UA = { "User-Agent": "PostFlow/1.0 (https://postfloow.netlify.app; logo lookup)" };

/** The subject's logo files on Wikimedia Commons, best match first. Rendered as PNG by Commons (SVGs too). */
async function commonsLogos(subject: string): Promise<Logo[]> {
  const q = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${subject} logo`,
    gsrlimit: "12",
    prop: "imageinfo",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: "900",
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${q}`, { headers: UA, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Wikimedia Commons HTTP ${res.status}`);
  const json = (await res.json()) as {
    query?: { pages?: Record<string, { index?: number; title: string; imageinfo?: { thumburl?: string; url?: string; descriptionurl?: string; mime?: string; extmetadata?: Record<string, { value?: string }> }[] }> };
  };
  const want = subject.toLowerCase().replace(/[^a-z0-9]/g, "");
  return Object.values(json.query?.pages ?? {})
    .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
    .flatMap((p) => {
      const info = p.imageinfo?.[0];
      const title = p.title.replace(/^File:/, "");
      const flat = title.toLowerCase().replace(/[^a-z0-9]/g, "");
      // Only files named after the subject and called a logo, wordmark or icon: not photos of people or offices.
      if (!info?.thumburl || !flat.includes(want) || !/logo|wordmark|icon|symbol/i.test(title)) return [];
      const license = info.extmetadata?.LicenseShortName?.value ?? "";
      return [{ url: info.thumburl, source: info.descriptionurl ?? info.url ?? info.thumburl, credit: `${subject} logo via Wikimedia Commons${license ? ` (${license})` : ""}`, title }];
    })
    // An SVG logo (vector, clean edges) before a bitmap one.
    .sort((a, b) => Number(/\.svg$/i.test(b.title)) - Number(/\.svg$/i.test(a.title)));
}

let logoSearch: (subject: string) => Promise<Logo[]> = commonsLogos;
/** Tests swap Wikimedia Commons for a stub. */
export function setLogoSearchForTests(fn: ((subject: string) => Promise<Logo[]>) | null) {
  logoSearch = fn ?? commonsLogos;
}

/** Downloads an image of a sensible size. */
async function download(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000), redirect: "follow" }).catch(() => null);
  if (!res?.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
  const data = Buffer.from(await res.arrayBuffer());
  return data.length > 200 && data.length < 15_000_000 ? data : null;
}

let fetchImage: (url: string) => Promise<Buffer | null> = download;
export function setImageDownloadForTests(fn: ((url: string) => Promise<Buffer | null>) | null) {
  fetchImage = fn ?? download;
}

/**
 * The logo centred on a plain 1200x675 card, as a compact JPEG both platforms accept. A light logo
 * (white on transparent) gets a dark card so it stays visible.
 */
export async function logoCard(logo: Buffer): Promise<{ data: Buffer; mime: string } | null> {
  try {
    const { default: sharp } = await import("sharp");
    const fitted = await sharp(logo).ensureAlpha().resize(640, 300, { fit: "inside" }).png().toBuffer();
    const { data, info } = await sharp(fitted).raw().toBuffer({ resolveWithObject: true });
    let sum = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] < 128) continue;
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      n++;
    }
    const light = n > 0 && sum / n > 215;
    const out = await sharp({ create: { width: 1200, height: 675, channels: 3, background: light ? "#18221e" : "#ffffff" } })
      .composite([{ input: fitted, gravity: "center" }])
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
    return { data: out, mime: "image/jpeg" };
  } catch (err) {
    log.warn("logo_card_failed", { error: (err as Error).message });
    return null;
  }
}

type Made = PostImage | { none: string };

/**
 * The subject, then its logo. Returns { none } when the post should simply go out as text: no single
 * subject, or no logo for it. Recorded with the model calls so lookups that fail are visible.
 */
async function makeImage(post: PostLike, avoid: string[] = []): Promise<Made | null> {
  const subject = await imageSubject(post);
  if (!subject) return { none: "This post is about a general idea, so it goes out as text only." };
  let logos: Logo[];
  try {
    logos = (await logoSearch(subject)).filter((l) => !avoid.includes(l.source));
  } catch (err) {
    const error = `logo search for ${subject}: ${(err as Error).message}`.slice(0, 500);
    log.warn("post_image_failed", { postId: post.id, error });
    await db().insert(schema.llmCalls).values({ userId: post.userId, task: "find_image", model: "wikimedia-commons", status: "error", error });
    return null;
  }
  for (const logo of logos.slice(0, 4)) {
    const raw = await fetchImage(logo.url);
    const card = raw && (await logoCard(raw));
    if (!card) continue;
    await db().insert(schema.llmCalls).values({ userId: post.userId, task: "find_image", model: "wikimedia-commons", status: "ok" });
    return { ...card, prompt: subject, source: logo.source, credit: logo.credit };
  }
  return { none: avoid.length ? `No other ${subject} logo found.` : `No ${subject} logo found, so this post goes out as text only.` };
}

let maker: ((post: PostLike, avoid?: string[]) => Promise<Made | null>) | null = makeImage;
/** Tests that are not about pictures switch finding them off, so no model calls are spent on them. */
export function setImageMakingForTests(on: boolean) {
  maker = on ? makeImage : null;
}

/** Remembers on the post that it goes out as text, so the subject is not looked up again on every view. */
async function markNoPicture(post: PostLike, reason: string) {
  const review = ((post.review ?? {}) as Record<string, unknown>) ?? {};
  await db().update(schema.posts).set({ review: { ...review, noPicture: reason } }).where(eq(schema.posts.id, post.id));
}

/** Why a post has no picture, when it was decided that it needs none. */
export function noPictureReason(post: Pick<PostLike, "review">): string | null {
  return ((post.review as { noPicture?: string } | null)?.noPicture as string | undefined) ?? null;
}

/** The post's stored picture, made now if there is none yet. Null when it cannot be made. Never throws. */
export async function ensurePostImage(post: PostLike, opts: { force?: boolean; avoid?: string[] } = {}): Promise<PostImage | null> {
  try {
    const have = await db().query.postImages.findFirst({ where: eq(schema.postImages.postId, post.id) });
    if (have) return { data: have.data, mime: have.mime, prompt: have.prompt, source: have.source, credit: have.credit };
    if (!maker) return null;
    if (noPictureReason(post) && !opts.force) return null;
    // After a failed drawing, wait a while before trying again on its own, so a broken image service does not eat the daily limit.
    if (!opts.force) {
      const failed = await db().query.llmCalls.findFirst({
        where: and(eq(schema.llmCalls.userId, post.userId), eq(schema.llmCalls.task, "find_image"), eq(schema.llmCalls.status, "error"), gt(schema.llmCalls.createdAt, new Date(Date.now() - 10 * 60_000))),
      });
      if (failed) return null;
    }
    const img = await maker(post, opts.avoid);
    if (!img) return null;
    if ("none" in img) {
      await markNoPicture(post, img.none);
      return null;
    }
    await db().insert(schema.postImages).values({ postId: post.id, userId: post.userId, ...img }).onConflictDoNothing();
    return img;
  } catch (err) {
    log.warn("post_image_failed", { postId: post.id, error: (err as Error).message });
    return null;
  }
}

/** Looks again: another logo, or one for a post that had none. The post's updatedAt moves so links refresh. */
export async function redrawPostImage(post: PostLike): Promise<PostImage | null> {
  const old = await db().query.postImages.findFirst({ where: eq(schema.postImages.postId, post.id) });
  const avoid = old?.source ? [old.source] : [];
  // Find the new one first, so a failed search keeps the photo that was there.
  if (!maker) return null;
  const img = await maker(post, avoid).catch(() => null);
  if (!img || "none" in img) return null;
  await db().delete(schema.postImages).where(eq(schema.postImages.postId, post.id));
  await db().insert(schema.postImages).values({ postId: post.id, userId: post.userId, ...img });
  const review = { ...((post.review ?? {}) as Record<string, unknown>) };
  delete review.noPicture;
  await db().update(schema.posts).set({ review, updatedAt: new Date() }).where(eq(schema.posts.id, post.id));
  return img;
}
