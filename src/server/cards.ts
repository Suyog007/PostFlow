// Image cards for posts: a branded picture of the post's hook, attached when it is published
// and shown in the Telegram reminder and the app. Rendered by /api/cards/[id].

import crypto from "node:crypto";
import { env } from "./env";
import { log } from "./log";
import type { Settings } from "./settings";

type PostLike = { id: string; platform: string; pillar: string; text: string; updatedAt: Date; review: unknown };

export interface CardContent {
  tag: string;
  tone: "news" | "alert" | "lesson" | "work";
  hook: string;
  sub: string;
  name: string;
  role: string;
}

const stripTags = (t: string) =>
  t
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

function clip(t: string, max: number) {
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 12)).replace(/[,;:\s]+$/, "")}…`;
}

/** What the card says: the hook in big type, one supporting line, and who it is from. */
export function cardContent(post: PostLike, profile: Pick<Settings["profile"], "name" | "role">): CardContent {
  const review = (post.review ?? {}) as { move?: string; material?: { kind?: string } };
  const paras = post.text
    .split(/\n\s*\n|\n/)
    .map(stripTags)
    .filter(Boolean);
  const hook = clip(paras[0] ?? "", 150);
  const rest = paras.slice(1).join(" ");
  const firstSentence = rest.match(/^.*?[.!?](\s|$)/)?.[0]?.trim() ?? rest;
  const tone: CardContent["tone"] = post.pillar === "learning" ? "lesson" : review.move === "explain" ? "alert" : post.pillar === "own_work" ? "work" : "news";
  const tag = { lesson: "Lesson", alert: "Heads-up", work: "From my work", news: "News" }[tone];
  return { tag, tone, hook, sub: clip(firstSentence, 170), name: profile.name || "", role: profile.role || "" };
}

function sign(id: string, v: number) {
  const secret = env().SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set, so image links cannot be signed.");
  return crypto.createHmac("sha256", secret).update(`card:${id}:${v}`).digest("hex").slice(0, 32);
}

/** A signed, cacheable URL for the post's card. Changing the post (its updatedAt) changes the URL. */
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

/** Whether a post goes out with its image: on for the platform in Settings, and not switched off for this post. */
export function wantsImage(post: Pick<PostLike, "platform" | "review">, s: Pick<Settings, "images">): boolean {
  if ((post.review as { noImage?: boolean } | null)?.noImage) return false;
  return !!s.images[post.platform as "x" | "linkedin"];
}

async function realLoadCard(post: Pick<PostLike, "id" | "updatedAt">): Promise<Buffer | null> {
  try {
    const res = await fetch(cardUrl(post), { signal: AbortSignal.timeout(20_000) });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) {
      log.warn("card_fetch_failed", { postId: post.id, status: res.status });
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    log.warn("card_fetch_failed", { postId: post.id, error: (err as Error).message });
    return null;
  }
}

let loader: (post: Pick<PostLike, "id" | "updatedAt">) => Promise<Buffer | null> = realLoadCard;
/** The card as PNG bytes, for uploading with the post. Null when it cannot be made: the post then goes out without it. */
export const loadCard = (post: Pick<PostLike, "id" | "updatedAt">) => loader(post);
export function setCardLoaderForTests(fn: ((post: Pick<PostLike, "id" | "updatedAt">) => Promise<Buffer | null>) | null) {
  loader = fn ?? realLoadCard;
}
