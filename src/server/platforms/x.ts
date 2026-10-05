import type { AccountCredentials, FoundPost, PlatformClient, PublishMedia, PublishOptions, PublishResult } from "./types";
import { classifyNetworkError } from "./types";

const API = "https://api.x.com/2";
export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
/** Minimum scopes: post, media upload, read own posts (reconciliation + metrics), identity, refresh tokens. */
export const X_SCOPES = ["tweet.read", "tweet.write", "media.write", "users.read", "offline.access"];

/** X bills per created post. Approximate USD list prices (2026): $0.015 text, $0.20 with URL, ~$0.005 per media op. */
const COST_TEXT = 0.015;
const COST_URL = 0.2;
const COST_MEDIA_OP = 0.005;

const THREAD_DELAY_MS = 2500;
const URL_RE = /https?:\/\/\S+/g;

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postOne(body: Record<string, unknown>, token: string) {
  return fetch(`${API}/tweets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
}

/** Upload one image. Returns the media id, or throws with a human message. */
async function uploadMedia(media: PublishMedia, token: string): Promise<string> {
  const form = new FormData();
  form.append("media", new Blob([new Uint8Array(media.data)], { type: media.mime || "image/png" }), "image");
  form.append("media_category", "tweet_image");
  const res = await fetch(`${API}/media/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => null)) as { data?: { id?: string }; detail?: string; title?: string } | null;
  if (!res.ok || !json?.data?.id) {
    throw new Error(`X media upload failed (HTTP ${res.status}): ${json?.detail ?? json?.title ?? "unknown"}`);
  }
  const id = json.data.id;
  if (media.alt) {
    // Best-effort: alt text improves reach and accessibility; never fail the upload over it.
    await fetch(`${API}/media/metadata`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id, metadata: { alt_text: { text: media.alt.slice(0, 1000) } } }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
  }
  return id;
}

export const xClient: PlatformClient = {
  /**
   * Text posts; several parts become a thread of replies (2.5s apart).
   * Media attaches to the first post. With linkInReply, URLs are stripped from the
   * posts and sent as a final reply — X charges ~13× for posts containing links.
   */
  async publish(parts: string[], creds: AccountCredentials, opts: PublishOptions = {}): Promise<PublishResult> {
    const ids: string[] = [];
    let costUsd = 0;

    // Upload media first: a failure here means nothing was posted (safe to retry).
    let mediaIds: string[] = [];
    if (opts.media?.length) {
      try {
        for (const m of opts.media.slice(0, 4)) {
          mediaIds.push(await uploadMedia(m, creds.accessToken));
          costUsd += COST_MEDIA_OP;
        }
      } catch (err) {
        return { kind: "failed", retryable: true, error: (err as Error).message };
      }
    }

    // Link handling: strip URLs from posts, send them as a final reply (X charges ~13× for links).
    let textParts = parts;
    let linkReply: string | null = null;
    if (opts.linkInReply) {
      const urls = Array.from(new Set(parts.join("\n").match(URL_RE) ?? [])).slice(0, 3);
      if (urls.length) {
        const stripped = parts.map((p) =>
          p
            .replace(URL_RE, "")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .replace(/ {2,}/g, " ")
            .trim(),
        );
        const kept = stripped.filter((p) => p !== "");
        if (kept.length === 0) {
          return { kind: "failed", retryable: false, error: "After moving links to a reply, the post text was empty. Edit the post." };
        }
        textParts = kept;
        linkReply = urls.join("\n");
      }
    }
    if (textParts.some((p) => p.trim() === "")) {
      return { kind: "failed", retryable: false, error: "The post contains an empty part. Edit the post." };
    }

    const thread = linkReply ? [...textParts, linkReply] : textParts;

    for (let i = 0; i < thread.length; i++) {
      const body: Record<string, unknown> = { text: thread[i] };
      if (ids.at(-1)) body.reply = { in_reply_to_tweet_id: ids.at(-1) };
      if (i === 0 && mediaIds.length) body.media = { media_ids: mediaIds };
      if (i > 0) await sleep(THREAD_DELAY_MS);

      let res: Response;
      try {
        res = await postOne(body, creds.accessToken);
      } catch (err) {
        const c = classifyNetworkError(err);
        if (c.safeToRetry && ids.length === 0) return { kind: "failed", retryable: true, error: c.message };
        return { kind: "ambiguous", error: c.message, partialIds: ids };
      }
      const json = (await res.json().catch(() => null)) as { data?: { id?: string }; detail?: string; title?: string } | null;
      if (res.status === 201 || (res.ok && json?.data?.id)) {
        ids.push(json!.data!.id!);
        costUsd += /https?:\/\//.test(thread[i]) ? COST_URL : COST_TEXT;
        continue;
      }
      const detail = json?.detail ?? json?.title ?? `HTTP ${res.status}`;
      if (res.status >= 500) return { kind: "ambiguous", error: `X server error: ${detail}`, httpStatus: res.status, partialIds: ids };
      const retryAfter = Number(res.headers.get("x-rate-limit-reset"));
      const failure: PublishResult = {
        kind: "failed",
        retryable: res.status === 429 && ids.length === 0,
        error: ids.length ? `Thread partially published (${ids.length}/${thread.length}): ${detail}` : `X rejected the post: ${detail}`,
        httpStatus: res.status,
        authError: res.status === 401,
        retryAfterSeconds: res.status === 429 && retryAfter ? Math.max(30, retryAfter - Math.floor(Date.now() / 1000)) : undefined,
        partialIds: ids,
      };
      return failure;
    }
    return { kind: "success", externalIds: ids, url: `https://x.com/i/web/status/${ids[0]}`, httpStatus: 201, costUsd: Math.round(costUsd * 1000) / 1000 };
  },

  async findRecentPost(text: string, since: Date, creds: AccountCredentials): Promise<FoundPost | null> {
    const url = new URL(`${API}/users/${encodeURIComponent(creds.externalUserId)}/tweets`);
    url.searchParams.set("max_results", "20");
    url.searchParams.set("start_time", new Date(since.getTime() - 60_000).toISOString());
    url.searchParams.set("tweet.fields", "created_at");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${creds.accessToken}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`X lookup failed: HTTP ${res.status}`);
    const json = (await res.json()) as { data?: { id: string; text: string }[] };
    const target = normalize(text);
    // X may shorten URLs to t.co; compare text with URLs removed.
    const strip = (s: string) => normalize(s.replace(/https?:\/\/\S+/g, ""));
    const hit = json.data?.find((t) => normalize(t.text) === target || strip(t.text) === strip(text));
    return hit ? { externalId: hit.id, url: `https://x.com/i/web/status/${hit.id}` } : null;
  },
};

export interface XMetrics {
  impressions: number | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  quotes: number | null;
  raw: unknown;
}

/** Own-post reads ($0.001/resource): public_metrics for up to 100 ids. */
export async function xFetchMetrics(ids: string[], creds: AccountCredentials): Promise<Map<string, XMetrics>> {
  const out = new Map<string, XMetrics>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  for (const chunk of chunks) {
    const url = new URL(`${API}/tweets`);
    url.searchParams.set("ids", chunk.join(","));
    url.searchParams.set("tweet.fields", "public_metrics");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${creds.accessToken}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`X metrics fetch failed: HTTP ${res.status}`);
    const json = (await res.json()) as {
      data?: { id: string; public_metrics?: { impression_count?: number; like_count?: number; retweet_count?: number; reply_count?: number; quote_count?: number } }[];
    };
    for (const t of json.data ?? []) {
      const m = t.public_metrics ?? {};
      out.set(t.id, {
        impressions: m.impression_count ?? null,
        likes: m.like_count ?? null,
        retweets: m.retweet_count ?? null,
        replies: m.reply_count ?? null,
        quotes: m.quote_count ?? null,
        raw: m,
      });
    }
  }
  return out;
}

export async function xFetchMe(accessToken: string) {
  const res = await fetch(`${API}/users/me`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Could not read X account: HTTP ${res.status}`);
  const json = (await res.json()) as { data: { id: string; username: string; name: string } };
  return { id: json.data.id, handle: `@${json.data.username}`, name: json.data.name };
}
