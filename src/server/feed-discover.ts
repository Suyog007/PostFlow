import { isPublicHttpUrl } from "./net";

const UA = "Mozilla/5.0 (compatible; PostFlowBot/0.2)";
const COMMON_PATHS = ["/feed", "/rss.xml", "/feed.xml", "/atom.xml", "/index.xml", "/rss"];

export interface FoundFeed {
  url: string;
  name: string;
}

type Page = { url: string; type: string; body: string } | null;
let fetchPage: (url: string) => Promise<Page> = realFetch;
/** Test hook: replace the network. */
export function setFeedFetchForTests(fn: ((url: string) => Promise<Page>) | null) {
  fetchPage = fn ?? realFetch;
}

async function realFetch(url: string): Promise<Page> {
  if (!isPublicHttpUrl(url)) return null;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, text/html;q=0.9, */*;q=0.5" },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!res.ok || !isPublicHttpUrl(res.url || url)) return null;
    return { url: res.url || url, type: res.headers.get("content-type") ?? "", body: (await res.text()).slice(0, 500_000) };
  } catch {
    return null;
  }
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<!\[CDATA\[|\]\]>/g, "").trim();

function looksLikeFeed(p: NonNullable<Page>) {
  return /(rss|atom)\+xml|\/xml|text\/xml/i.test(p.type) || /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(rss|feed|rdf:RDF)[\s>]/i.test(p.body);
}

function titleOf(body: string, fallback: string) {
  const m = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return (m ? decode(m[1]) : "").replace(/\s+/g, " ").slice(0, 80) || fallback;
}

/** Turns what people paste (a homepage, "myblog.com", a subreddit) into a URL to try. */
export function normalizeInput(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    // A subreddit page has its feed at the same address plus .rss.
    if (/(^|\.)reddit\.com$/i.test(u.hostname) && /^\/r\/[^/]+\/?$/i.test(u.pathname)) u.pathname = `${u.pathname.replace(/\/$/, "")}/.rss`;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Finds the RSS or Atom feed for a link: the link itself if it is a feed, the feed a page
 * announces in its <head>, or a feed at a common address. Null when there is none.
 */
export async function discoverFeed(raw: string): Promise<FoundFeed | null> {
  const start = normalizeInput(raw);
  if (!start || !isPublicHttpUrl(start)) return null;
  const host = new URL(start).hostname.replace(/^www\./, "");
  const page = await fetchPage(start);
  if (!page) return null;
  if (looksLikeFeed(page)) return { url: page.url, name: titleOf(page.body, host) };

  const candidates: string[] = [];
  for (const tag of page.body.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel=["']?alternate/i.test(tag) || !/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (href) {
      try {
        candidates.push(new URL(decode(href), page.url).toString());
      } catch {
        /* bad href */
      }
    }
  }
  const origin = new URL(page.url).origin;
  for (const p of COMMON_PATHS) candidates.push(`${origin}${p}`);

  const pageTitle = titleOf(page.body, host);
  for (const url of [...new Set(candidates)].slice(0, 8)) {
    if (!isPublicHttpUrl(url)) continue;
    const feed = await fetchPage(url);
    if (feed && looksLikeFeed(feed)) return { url: feed.url, name: titleOf(feed.body, pageTitle) };
  }
  return null;
}
