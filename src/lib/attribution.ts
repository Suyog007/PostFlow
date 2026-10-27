// Where a visitor came from, kept in a first-party cookie so a later sign-up or waitlist entry can say so.
// Only a short label is stored ("reddit", "linkedin / launch-week"), never a full URL.

export const SOURCE_COOKIE = "pf_src";
export const SOURCE_MAX_AGE_DAYS = 30;

/** Well-known sites under one readable name. */
const SITES: [RegExp, string][] = [
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, "linkedin"],
  [/(^|\.)(x|twitter)\.com$|^t\.co$/, "x"],
  [/(^|\.)reddit\.com$/, "reddit"],
  [/^news\.ycombinator\.com$/, "hacker news"],
  [/(^|\.)indiehackers\.com$/, "indie hackers"],
  [/(^|\.)producthunt\.com$/, "product hunt"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "facebook"],
  [/(^|\.)(t\.me|telegram\.org)$/, "telegram"],
  [/(^|\.)(discord\.com|discord\.gg)$/, "discord"],
  [/(^|\.)github\.com$/, "github"],
  [/(^|\.)google\.[a-z.]+$/, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
];

/** Lowercase letters, digits, spaces and . _ - / only, at most 60 characters. */
export function cleanSource(s: string | null | undefined): string | null {
  const v = (s ?? "").toLowerCase().replace(/[^a-z0-9 ._\-/]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  return v || null;
}

function siteName(host: string) {
  const h = host.toLowerCase().replace(/^www\./, "");
  return SITES.find(([re]) => re.test(h))?.[1] ?? h;
}

/**
 * The label for one visit. A ?ref= or ?utm_source= tag wins (that is what you put in links you share);
 * otherwise the site the visitor clicked through from; otherwise "direct".
 */
export function sourceFor(search: string, referrer: string, ownHost: string): string {
  const q = new URLSearchParams(search);
  const tag = q.get("ref") || q.get("utm_source") || q.get("source");
  const campaign = q.get("utm_campaign");
  let label: string | null = tag ? siteName(tag) : null;
  if (!label && referrer) {
    try {
      const host = new URL(referrer).hostname;
      if (host && host !== ownHost) label = siteName(host);
    } catch {
      /* not a URL */
    }
  }
  return cleanSource(`${label ?? "direct"}${campaign ? ` / ${campaign}` : ""}`) ?? "direct";
}
