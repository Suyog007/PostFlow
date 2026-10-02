import Parser from "rss-parser";
import { and, eq, gte, asc } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env } from "../env";
import { hostOf, parseDate, stripHtml } from "./normalize";

export interface RawEntry {
  sourceId: string;
  url: string;
  title: string;
  excerpt: string;
  publishedAt: Date | null;
  publisher: string;
  isPrimary: boolean;
  kind: "article" | "repo";
  topicHint: string | null;
  meta: Record<string, unknown>;
}

type Source = typeof schema.sources.$inferSelect;

const UA = "PostFlow/0.1 (personal feed reader; respects robots and rate limits)";

const parser = new Parser({ timeout: 20_000, headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5" } });

export async function collectRss(source: Source): Promise<RawEntry[]> {
  // Fetch ourselves: fetch() handles gzip/brotli and redirects, which parser.parseURL does not.
  const res = await fetch(source.url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Feed HTTP ${res.status}`);
  const feed = await parser.parseString((await res.text()).replace(/^\uFEFF/, "").trimStart());
  const max = Number((source.config as { maxItems?: number }).maxItems ?? 30);
  return (feed.items ?? []).slice(0, max).flatMap((it) => {
    const url = it.link ?? it.guid;
    if (!url || !/^https?:\/\//.test(url) || !it.title) return [];
    const excerpt = stripHtml(it.contentSnippet ?? it.summary ?? it.content ?? "").slice(0, 1200);
    return [
      {
        sourceId: source.id,
        url,
        title: stripHtml(it.title).slice(0, 300),
        excerpt,
        publishedAt: parseDate(it.isoDate ?? it.pubDate),
        publisher: source.name || feed.title || hostOf(url),
        isPrimary: source.isPrimary,
        kind: "article" as const,
        topicHint: source.topicHint,
        meta: { categories: (it.categories ?? []).slice(0, 8) },
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// GitHub: official REST search API + our own star snapshots for growth
// ---------------------------------------------------------------------------

interface GhRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  topics?: string[];
  license: { spdx_id: string | null } | null;
  created_at: string;
  pushed_at: string;
  homepage: string | null;
  archived: boolean;
  fork: boolean;
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": UA };
  const token = env().GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** `{{days:30}}` in a query becomes the ISO date 30 days ago. */
export function expandQuery(q: string, now = new Date()) {
  return q.replace(/\{\{days:(\d+)\}\}/g, (_, d) => new Date(now.getTime() - Number(d) * 86_400_000).toISOString().slice(0, 10));
}

async function ghGet<T>(path: string): Promise<T | null> {
  const res = await fetch(`https://api.github.com${path}`, { headers: ghHeaders(), signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 429) {
    throw new Error(`GitHub rate limit reached (remaining ${res.headers.get("x-ratelimit-remaining") ?? "?"}). Add GITHUB_TOKEN to raise it.`);
  }
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Measured growth from our own snapshots, only when they span at least ~20 hours. */
export async function measuredGrowth(fullName: string, currentStars: number, now = new Date()) {
  const first = await db().query.repoSnapshots.findFirst({
    where: and(eq(schema.repoSnapshots.fullName, fullName), gte(schema.repoSnapshots.capturedAt, new Date(now.getTime() - 8 * 86_400_000))),
    orderBy: asc(schema.repoSnapshots.capturedAt),
  });
  if (!first) return null;
  const days = (now.getTime() - first.capturedAt.getTime()) / 86_400_000;
  if (days < 0.8) return null;
  return { starsGained: currentStars - first.stars, days: Math.round(days * 10) / 10, perDay: Math.round((currentStars - first.stars) / days) };
}

export async function collectGithub(source: Source, now = new Date()): Promise<RawEntry[]> {
  const cfg = source.config as { query?: string; perPage?: number };
  const q = expandQuery(cfg.query ?? "created:>{{days:21}} stars:>150", now);
  const perPage = Math.min(cfg.perPage ?? 20, 50);
  const data = await ghGet<{ items: GhRepo[] }>(`/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${perPage}`);
  const out: RawEntry[] = [];
  // /releases/latest costs the core rate limit; without a token that is only 60 requests/hour.
  // Fetch it for the first few (highest-star) repos and back off for the rest of the run on 403.
  let releaseLookups = 0;
  let releaseRateLimited = false;
  for (const r of data?.items ?? []) {
    if (r.archived || r.fork) continue;
    const ageDays = Math.max(1, (now.getTime() - new Date(r.created_at).getTime()) / 86_400_000);
    const growth = await measuredGrowth(r.full_name, r.stargazers_count, now);
    await db().insert(schema.repoSnapshots).values({
      fullName: r.full_name,
      stars: r.stargazers_count,
      forks: r.forks_count,
      openIssues: r.open_issues_count,
      pushedAt: new Date(r.pushed_at),
      capturedAt: now,
    });
    let release: { tag_name: string; published_at: string; name: string | null } | null = null;
    if (!releaseRateLimited && releaseLookups < 10) {
      releaseLookups++;
      try {
        release = await ghGet(`/repos/${r.full_name}/releases/latest`);
      } catch (err) {
        if (/rate limit/i.test((err as Error).message)) releaseRateLimited = true;
        release = null;
      }
    }
    const pushedDaysAgo = (now.getTime() - new Date(r.pushed_at).getTime()) / 86_400_000;
    // A claim of "gaining attention" needs a basis we can state.
    const attentionBasis = growth && growth.starsGained > 0
      ? `Gained ${growth.starsGained.toLocaleString()} stars in the last ${growth.days} days (measured by PostFlow).`
      : ageDays <= 45
        ? `Created ${Math.round(ageDays)} days ago and already has ${r.stargazers_count.toLocaleString()} stars (~${Math.round(r.stargazers_count / ageDays)}/day on average).`
        : null;
    out.push({
      sourceId: source.id,
      url: r.html_url,
      title: `${r.full_name}: ${r.description ?? "(no description)"}`.slice(0, 300),
      excerpt: [
        r.description ?? "",
        `Stars: ${r.stargazers_count}. Forks: ${r.forks_count}. Open issues: ${r.open_issues_count}.`,
        `Language: ${r.language ?? "n/a"}. License: ${r.license?.spdx_id ?? "none stated"}.`,
        `Created: ${r.created_at.slice(0, 10)}. Last push: ${r.pushed_at.slice(0, 10)}.`,
        release ? `Latest release: ${release.tag_name} on ${release.published_at?.slice(0, 10)}.` : "No releases published.",
        attentionBasis ?? "",
        r.topics?.length ? `Topics: ${r.topics.slice(0, 10).join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      publishedAt: release && new Date(release.published_at) > new Date(r.created_at) ? parseDate(release.published_at) : parseDate(r.created_at),
      publisher: "GitHub",
      isPrimary: true,
      kind: "repo",
      topicHint: source.topicHint ?? "open-source",
      meta: {
        repo: {
          fullName: r.full_name,
          stars: r.stargazers_count,
          forks: r.forks_count,
          openIssues: r.open_issues_count,
          language: r.language,
          license: r.license?.spdx_id ?? null,
          createdAt: r.created_at,
          pushedAt: r.pushed_at,
          pushedDaysAgo: Math.round(pushedDaysAgo),
          homepage: r.homepage,
          topics: r.topics ?? [],
          latestRelease: release ? { tag: release.tag_name, publishedAt: release.published_at } : null,
          measuredGrowth: growth,
          attentionBasis,
        },
      },
    });
  }
  return out;
}

export async function collectSource(source: Source): Promise<RawEntry[]> {
  if (source.kind === "rss") return collectRss(source);
  if (source.kind === "github_search") return collectGithub(source);
  return [];
}

/** URLs come from untrusted feeds: refuse local and private-network targets. */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h.includes(":")) return false; // IPv6 literals
  if (!h.includes(".")) return false;
  return true;
}

/** Fetch readable text from an article page for "Research deeper". Bounded and best-effort. */
export async function fetchArticleText(url: string, maxChars = 8000): Promise<string | null> {
  if (!isPublicHttpUrl(url)) return null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(15_000), redirect: "follow" });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("text")) return null;
    const html = (await res.text()).slice(0, 600_000);
    const main = html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;
    const text = stripHtml(main.replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " "));
    return text.slice(0, maxChars);
  } catch {
    return null;
  }
}
