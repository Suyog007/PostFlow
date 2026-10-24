// Going deeper on something the owner sent: an X post, a link or a topic in their own words.
// Reads the source, follows its links, looks for other coverage, then judges whether it is worth a post.

import Parser from "rss-parser";
import { z } from "zod";
import { fetchArticle, isPublicHttpUrl } from "./net";
import { checkStory, registrableDomain, searchNews, type Mention } from "./verify";
import { runTask, untrusted } from "./llm";
import { profileBlock } from "./prompts";
import { log } from "./log";
import type { Material } from "./generate";
import type { Settings } from "./settings";

const UA = "Mozilla/5.0 (compatible; PostFlowBot/0.2; +personal-use)";

// ---------------------------------------------------------------------------
// X posts
// ---------------------------------------------------------------------------

export interface XPost {
  url: string;
  author: string;
  handle: string;
  text: string;
  createdAt: string | null;
  /** Links in the post (articles, product pages), never other X posts. */
  links: string[];
  quoted: { author: string; handle: string; text: string } | null;
}

const X_STATUS = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/i;

export function parseXUrl(url: string): { handle: string; id: string } | null {
  const m = url.match(X_STATUS);
  return m ? { handle: m[1], id: m[2] } : null;
}

const isXHost = (u: string) => /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/i.test(safeHost(u));
function safeHost(u: string) {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}

/** The token X's public embed feed expects for a post id (the same one embedded tweets on websites use). */
export function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

interface SyndicationPost {
  text?: string;
  created_at?: string;
  user?: { name?: string; screen_name?: string };
  entities?: { urls?: { expanded_url?: string }[] };
  card?: { url?: string; binding_values?: { card_url?: { string_value?: string } } };
  quoted_tweet?: SyndicationPost;
}

function fromSyndication(j: SyndicationPost, url: string): XPost {
  const links = new Set<string>();
  for (const u of j.entities?.urls ?? []) if (u.expanded_url) links.add(u.expanded_url);
  const card = j.card?.binding_values?.card_url?.string_value ?? j.card?.url;
  if (card) links.add(card);
  const q = j.quoted_tweet;
  return {
    url,
    author: j.user?.name ?? "",
    handle: j.user?.screen_name ?? parseXUrl(url)?.handle ?? "",
    // Drop the t.co shortcuts at the end of the text; the real links are listed separately.
    text: (j.text ?? "").replace(/\s*https:\/\/t\.co\/\w+/g, "").trim(),
    createdAt: j.created_at ?? null,
    links: [...links].filter((l) => isPublicHttpUrl(l) && !isXHost(l)).slice(0, 4),
    quoted: q?.text ? { author: q.user?.name ?? "", handle: q.user?.screen_name ?? "", text: q.text.replace(/\s*https:\/\/t\.co\/\w+/g, "").trim() } : null,
  };
}

async function realReadXPost(url: string): Promise<XPost | null> {
  const p = parseXUrl(url);
  if (!p) return null;
  try {
    const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${p.id}&lang=en&token=${syndicationToken(p.id)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12_000) });
    if (res.ok) {
      const j = (await res.json()) as SyndicationPost;
      if (j?.text) return fromSyndication(j, url);
    }
  } catch (err) {
    log.warn("x_syndication_failed", { id: p.id, error: (err as Error).message });
  }
  // Fallback: the public oEmbed endpoint, which returns the post's text as HTML.
  try {
    const res = await fetch(`https://publish.twitter.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(url)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { author_name?: string; author_url?: string; html?: string };
    const para = j.html?.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "";
    const hrefs = [...para.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => isPublicHttpUrl(h) && !isXHost(h) && !/\/hashtag\//.test(h));
    const text = para.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s*pic\.twitter\.com\/\w+/g, "").trim();
    if (!text) return null;
    return { url, author: j.author_name ?? "", handle: j.author_url?.split("/").pop() ?? p.handle, text, createdAt: null, links: hrefs.slice(0, 4), quoted: null };
  } catch (err) {
    log.warn("x_oembed_failed", { id: p.id, error: (err as Error).message });
    return null;
  }
}

let xReader: (url: string) => Promise<XPost | null> = realReadXPost;
export const readXPost = (url: string) => xReader(url);
export function setXReaderForTests(fn: ((url: string) => Promise<XPost | null>) | null) {
  xReader = fn ?? realReadXPost;
}

// ---------------------------------------------------------------------------
// Finding readable articles on a topic (Google News gives titles, Bing News gives article links)
// ---------------------------------------------------------------------------

const rss = new Parser({ timeout: 12_000 });

async function realFindArticles(query: string): Promise<string[]> {
  try {
    const feed = await rss.parseURL(`https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`);
    const out: string[] = [];
    for (const it of feed.items ?? []) {
      const link = it.link ?? "";
      let target = link;
      try {
        target = new URL(link).searchParams.get("url") ?? link;
      } catch (err) {
        log.warn("article_link_unparsable", { link: link.slice(0, 120), error: (err as Error).message });
      }
      if (isPublicHttpUrl(target)) out.push(target);
    }
    return out.slice(0, 6);
  } catch (err) {
    log.warn("article_search_failed", { error: (err as Error).message });
    return [];
  }
}

let articleFinder: (query: string) => Promise<string[]> = realFindArticles;
export function setArticleFinderForTests(fn: ((q: string) => Promise<string[]>) | null) {
  articleFinder = fn ?? realFindArticles;
}

/** Up to `n` readable articles about the topic, from publishers other than `exclude`. */
async function readCoverage(query: string, exclude: string[], n = 2): Promise<{ url: string; title: string; text: string }[]> {
  const out: { url: string; title: string; text: string }[] = [];
  for (const url of await articleFinder(query)) {
    if (out.length >= n) break;
    const host = registrableDomain(url);
    if (exclude.includes(host) || out.some((o) => registrableDomain(o.url) === host)) continue;
    const a = await fetchArticle(url, 3500);
    if (a) out.push({ url, title: a.title, text: a.text });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Judging the story
// ---------------------------------------------------------------------------

const assessOut = z.object({
  worth: z.number().min(0).max(10),
  why: z.string(),
  kind: z.enum(["must_know", "opportunity", "other"]),
  facts: z.array(z.object({ fact: z.string(), source: z.string() })),
  angle: z.string(),
});
export type Assessment = z.infer<typeof assessOut>;

/** Below this the owner is told it is weak and offered "write it anyway". */
export const MIN_WORTH = 6;

export class NotWorthError extends Error {
  constructor(
    public why: string,
    public worth: number,
  ) {
    super(`Not worth a post (${worth}/10): ${why}`);
  }
}

function keywords(text: string, n = 12): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#@]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, n)
    .join(" ");
}

async function assess(s: Settings, gathered: string): Promise<Assessment> {
  return runTask({
    task: "assess_story",
    role: "analyst",
    system: `You research a story for one person's LinkedIn and X audience, then decide whether it deserves a post from them.
${profileBlock(s)}
Score "worth" 0-10: is it new, specific and something this person's audience (developers, builders, founders, and the topics above) would care about, talk about or act on? 0-3 skip, 4-5 weak, 6-7 decent, 8-10 strong. A big launch or shift that many people are discussing scores high even without a direct "opportunity".
"why": one or two plain sentences the owner will read, saying why it is or is not worth posting.
"kind": "must_know" for vulnerabilities, attacks, outages, shutdowns; "opportunity" for openings builders can act on; "other" otherwise.
"facts": the key facts, ONLY from the texts given, each with who said it ("the post by @jack", "block.xyz", "The Verge"). When only the company or its founder says something (like "the most authentic model ever built"), write it as their claim, not as fact.
"angle": the most interesting angle for this audience, in one sentence, with no new facts.`,
    user: untrusted("research", gathered, 14000),
    output: assessOut,
    maxTokens: 2000,
    temperature: 0.2,
  });
}

export interface Research {
  material: Material;
  assessment: Assessment;
}

function buildMaterial(parts: { label: string; sourceUrl?: string; sections: string[]; assessment: Assessment; verification: Material["verification"]; angle?: string }): Material {
  const a = parts.assessment;
  const source = [
    ...parts.sections,
    a.facts.length ? `FACT SHEET (checked against the texts above):\n${a.facts.map((f) => `- ${f.fact} (${f.source})`).join("\n")}` : "",
    a.angle ? `SUGGESTED ANGLE (an assistant's idea, not a fact): ${a.angle}` : "",
    parts.angle ? `OWNER'S ANGLE (their own view or instruction; use it as the point of the post, framed as their opinion):\n${parts.angle}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { kind: "news", pillar: "news", source, label: parts.label, sourceUrl: parts.sourceUrl, firstPerson: false, verification: parts.verification, mustKnow: a.kind === "must_know" };
}

const coverageBlock = (mentions: Mention[]) => (mentions.length ? `OTHER COVERAGE (headlines from other publishers):\n${mentions.slice(0, 6).map((m) => `- ${m.domain}: ${m.title}`).join("\n")}` : "");

/** Research a link: an X post (and what it links to) or an article, plus other coverage. */
export async function researchLink(url: string, s: Settings, angle?: string): Promise<Research> {
  const sections: string[] = [];
  let title = "";
  let summary = "";
  const exclude: string[] = [];

  if (parseXUrl(url)) {
    const post = await readXPost(url);
    if (!post) throw new Error("I could not read that X post (it may be private, deleted or age-restricted). Paste its text and I will work from that.");
    title = `${post.author || `@${post.handle}`}: ${post.text.split("\n")[0].slice(0, 120)}`;
    summary = post.text;
    sections.push(`THE X POST by ${post.author} (@${post.handle})${post.createdAt ? `, ${post.createdAt}` : ""}:\n${untrusted("x post", post.text, 3000)}`);
    if (post.quoted) sections.push(`IT QUOTES a post by ${post.quoted.author} (@${post.quoted.handle}):\n${untrusted("quoted post", post.quoted.text, 1500)}`);
    for (const link of post.links.slice(0, 2)) {
      const a = await fetchArticle(link, 6000);
      if (a) {
        sections.push(`THE PAGE THE POST LINKS TO (${new URL(link).hostname}), "${a.title}":\n${untrusted("linked page", a.text, 6000)}`);
        exclude.push(registrableDomain(link));
        if (!title.includes(a.title)) summary = `${a.title}. ${summary}`;
      }
    }
  } else {
    const a = await fetchArticle(url, 8000);
    if (!a && (!angle || angle.length < 20)) throw new Error("I could not read that page (it may be behind a paywall). Paste the key points as text and I will work from those.");
    title = a?.title ?? new URL(url).hostname;
    summary = a?.text.slice(0, 600) ?? angle ?? "";
    sections.push(a ? `THE ARTICLE (${new URL(url).hostname}), "${a.title}":\n${untrusted("article", a.text, 8000)}` : `(The page could not be read; rely only on the owner's description.)`);
    exclude.push(registrableDomain(url));
  }

  const query = keywords(summary || title);
  const mentions = await searchNews(query).catch((err: Error) => {
    log.warn("coverage_search_failed", { error: err.message });
    return [] as Mention[];
  });
  const more = await readCoverage(query, exclude, 1);
  sections.push(coverageBlock(mentions));
  for (const m of more) sections.push(`ANOTHER PUBLISHER'S ARTICLE (${new URL(m.url).hostname}), "${m.title}":\n${untrusted("coverage", m.text, 3500)}`);

  const assessment = await assess(s, sections.filter(Boolean).join("\n\n"));
  const verification = await checkStory({ url, title, summary });
  return { material: buildMaterial({ label: title, sourceUrl: url, sections: sections.filter(Boolean), assessment, verification, angle }), assessment };
}

/** Research a topic the owner described in their own words: find coverage, read the best of it, judge it. */
export async function researchTopic(text: string, s: Settings): Promise<Research> {
  const query = keywords(text);
  const mentions = await searchNews(query).catch((err: Error) => {
    log.warn("coverage_search_failed", { error: err.message });
    return [] as Mention[];
  });
  const articles = await readCoverage(query, [], 2);
  if (!mentions.length && !articles.length) throw new Error("I could not find any coverage of that. Send a link, or describe it in more detail and use /post to write from your own words.");
  const sections = [
    `WHAT THE OWNER SENT (their words; a lead, not a verified fact):\n${untrusted("owner text", text, 1500)}`,
    ...articles.map((a) => `AN ARTICLE ABOUT IT (${new URL(a.url).hostname}), "${a.title}":\n${untrusted("article", a.text, 3500)}`),
    coverageBlock(mentions),
  ].filter(Boolean);
  const assessment = await assess(s, sections.join("\n\n"));
  const lead = articles[0];
  const verification = lead ? await checkStory({ url: lead.url, title: lead.title, summary: lead.text.slice(0, 400) }) : undefined;
  return { material: buildMaterial({ label: lead?.title ?? text.slice(0, 80), sourceUrl: lead?.url, sections, assessment, verification }), assessment };
}
