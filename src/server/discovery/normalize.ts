import { sha256 } from "../crypto";

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|ref_url|source|ncid|cmpid|guccounter|_hsenc|_hsmi|igshid|spm|si)$/i;

/** Deterministic URL canonicalization for exact deduplication. */
export function canonicalUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return raw.trim();
  }
  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase().replace(/^(www\.|m\.|amp\.)/, "");
  u.hash = "";
  if ((u.port === "443" || u.port === "80")) u.port = "";
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = "";
  for (const [k, v] of keep) u.searchParams.append(k, v);
  u.pathname = u.pathname.replace(/\/amp\/?$/, "/").replace(/\/+$/, "") || "/";
  return u.toString().replace(/\/$/, "");
}

export function urlHash(raw: string) {
  return sha256(canonicalUrl(raw));
}

const STOP = new Set(
  "a an the and or but of to in on for with at by from as is are was were be been it its this that these those how why what when who new over into about after up out vs via your you we our their his her has have had will can could just more most than".split(
    " ",
  ),
);

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`"“”]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleTokens(title: string): Set<string> {
  return new Set(
    normalizeTitle(title)
      .split(" ")
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w)),
  );
}

/**
 * Jaccard similarity of significant title tokens (0..1). Titles with fewer than 3 significant
 * tokens (e.g. recurring show names like "Tech Now") are never considered similar.
 */
export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size < 3 || tb.size < 3) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Two reports are about the same development when titles overlap strongly. */
export const SAME_STORY_THRESHOLD = 0.55;

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#8217;|&rsquo;/g, "'")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  // Guard against feeds with future or absurd dates.
  if (d.getTime() > Date.now() + 2 * 3_600_000) return null;
  if (d.getFullYear() < 2000) return null;
  return d;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
