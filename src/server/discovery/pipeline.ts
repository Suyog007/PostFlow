import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, schema } from "../db/client";
import { log } from "../log";
import { getUserPreferences, type Preferences } from "../preferences";
import { llmConfigured, runTask, untrusted, LLMError } from "../llm";
import { analysisBatchSchema, analysisSystem, PROMPT_VERSIONS, type AnalysisItem } from "../llm/prompts";
import { collectSource, type RawEntry } from "./collect";
import { canonicalUrl, normalizeTitle, titleSimilarity, titleTokens, urlHash, SAME_STORY_THRESHOLD, hostOf } from "./normalize";
import { evidenceScore, explainScore, recencyScore, SCORE_VERSION, totalScore, type Penalty } from "./scoring";
import { sha256 } from "../crypto";
import { generateDrafts } from "../content";

type Item = typeof schema.items.$inferSelect;

export interface RunStats {
  sourcesPolled: number;
  sourceErrors: { source: string; error: string }[];
  collected: number;
  newItems: number;
  mergedReports: number;
  filtered: number;
  analyzed: number;
  autoDrafted?: number;
  skippedByModel: number;
  briefed: number;
  llm: "ok" | "not_configured" | "budget" | "error" | "disabled";
  llmError?: string;
}

// ---------------------------------------------------------------------------
// 1-3. Collect, normalize, deduplicate & group
// ---------------------------------------------------------------------------

export async function ingest(entries: RawEntry[], now = new Date()) {
  let created = 0;
  let merged = 0;
  const recent = await db().query.items.findMany({
    where: gte(schema.items.firstSeenAt, new Date(now.getTime() - 4 * 86_400_000)),
    columns: { id: true, title: true, kind: true },
  });

  for (const e of entries) {
    const hash = urlHash(e.url);
    const existing = await db().query.itemSources.findFirst({ where: eq(schema.itemSources.urlHash, hash) });
    if (existing) {
      if (e.kind === "repo") {
        // Refresh repo stats on the existing item; the item itself is unchanged.
        await db()
          .update(schema.items)
          .set({ meta: e.meta, excerpt: e.excerpt })
          .where(eq(schema.items.id, existing.itemId));
      }
      continue;
    }

    // Same development reported elsewhere? Attach as supporting source.
    const match = e.kind === "article" ? recent.find((r) => r.kind === "article" && titleSimilarity(r.title, e.title) >= SAME_STORY_THRESHOLD) : undefined;
    if (match) {
      await db()
        .insert(schema.itemSources)
        .values({ itemId: match.id, sourceId: e.sourceId, url: e.url, urlHash: hash, title: e.title, publisher: e.publisher, excerpt: e.excerpt.slice(0, 800), publishedAt: e.publishedAt, isPrimary: e.isPrimary })
        .onConflictDoNothing();
      merged++;
      continue;
    }

    const [item] = await db()
      .insert(schema.items)
      .values({
        kind: e.kind,
        title: e.title,
        normalizedTitle: normalizeTitle(e.title),
        canonicalUrl: canonicalUrl(e.url),
        excerpt: e.excerpt,
        contentHash: sha256(`${e.title}\n${e.excerpt}`),
        publishedAt: e.publishedAt,
        firstSeenAt: now,
        meta: { ...e.meta, topicHint: e.topicHint },
      })
      .returning();
    const inserted = await db()
      .insert(schema.itemSources)
      .values({ itemId: item.id, sourceId: e.sourceId, url: e.url, urlHash: hash, title: e.title, publisher: e.publisher, excerpt: e.excerpt.slice(0, 800), publishedAt: e.publishedAt, isPrimary: e.isPrimary })
      .onConflictDoNothing()
      .returning({ id: schema.itemSources.id });
    if (inserted.length === 0) {
      // Lost a race with a concurrent run.
      await db().delete(schema.items).where(eq(schema.items.id, item.id));
      continue;
    }
    recent.push({ id: item.id, title: item.title, kind: item.kind });
    created++;
  }
  return { created, merged };
}

// ---------------------------------------------------------------------------
// 4. Deterministic filtering + cheap prefilter ranking
// ---------------------------------------------------------------------------

export function isStale(item: Pick<Item, "kind" | "publishedAt" | "meta">, prefs: Preferences, now: Date) {
  if (!item.publishedAt) return false;
  const ageDays = (now.getTime() - item.publishedAt.getTime()) / 86_400_000;
  if (item.kind === "repo") {
    const repo = (item.meta as { repo?: { pushedDaysAgo?: number } }).repo;
    return ageDays > 60 || (repo?.pushedDaysAgo ?? 0) > 30;
  }
  return ageDays > prefs.briefing.staleNewsDays;
}

export function mutedTermHit(text: string, muted: string[]) {
  const t = text.toLowerCase();
  return muted.find((m) => m.trim() && t.includes(m.toLowerCase().trim())) ?? null;
}

export async function feedbackSignals(userId: string, now: Date) {
  const rows = await db()
    .select({ action: schema.feedback.action, category: schema.feedback.category, n: sql<number>`count(*)` })
    .from(schema.feedback)
    .where(and(eq(schema.feedback.userId, userId), gte(schema.feedback.createdAt, new Date(now.getTime() - 60 * 86_400_000))))
    .groupBy(schema.feedback.action, schema.feedback.category);
  const byCategory = new Map<string, number>();
  const w: Record<string, number> = { saved: 1, researched: 1, approved: 1.5, published: 2, dismissed: -1, rejected: -0.5 };
  for (const r of rows) {
    if (!r.category) continue;
    byCategory.set(r.category.toLowerCase(), (byCategory.get(r.category.toLowerCase()) ?? 0) + (w[r.action] ?? 0) * Number(r.n));
  }
  return byCategory;
}

export function prefilterScore(item: Pick<Item, "title" | "excerpt" | "publishedAt" | "meta" | "kind">, prefs: Preferences, now: Date) {
  const text = titleTokens(item.kind === "repo" ? item.title : `${item.title} ${item.excerpt ?? ""}`);
  let s = 0;
  for (const [topic, weight] of Object.entries(prefs.interests)) {
    const tt = titleTokens(topic);
    let hits = 0;
    for (const t of tt) if (text.has(t)) hits++;
    if (hits) s += weight * (hits / tt.size) * 3;
  }
  const hint = (item.meta as { topicHint?: string }).topicHint;
  if (hint) s += 0.5;
  s += recencyScore(item.publishedAt, now, null) * 0.4;
  if ((item.excerpt ?? "").length > 200) s += 0.3;
  const repo = (item.meta as { repo?: { attentionBasis?: string | null } }).repo;
  if (item.kind === "repo" && repo?.attentionBasis) s += 0.3;
  return Math.round(s * 100) / 100;
}

async function filterNew(prefs: Preferences, now: Date) {
  const fresh = await db().query.items.findMany({ where: eq(schema.items.status, "new") });
  let filtered = 0;
  for (const it of fresh) {
    let reason: string | null = null;
    if (isStale(it, prefs, now)) reason = "stale";
    const muted = mutedTermHit(`${it.title} ${it.excerpt ?? ""}`, prefs.mutedTerms);
    if (!reason && muted) reason = `muted term: ${muted}`;
    if (!reason && it.title.split(/\s+/).length < 3 && it.kind !== "repo") reason = "too little information";
    if (reason) {
      await db().update(schema.items).set({ status: "filtered", filterReason: reason }).where(eq(schema.items.id, it.id));
      filtered++;
    } else {
      await db().update(schema.items).set({ prefilterScore: prefilterScore(it, prefs, now) }).where(eq(schema.items.id, it.id));
    }
  }
  return filtered;
}

// ---------------------------------------------------------------------------
// 5-9. Analyze (LLM, batched & cached) and score (deterministic)
// ---------------------------------------------------------------------------

async function analyzeBatch(batch: Item[], prefs: Preferences): Promise<AnalysisItem[]> {
  const sourcesByItem = await db().query.itemSources.findMany({ where: inArray(schema.itemSources.itemId, batch.map((b) => b.id)) });
  const blocks = batch.map((it, i) => {
    const srcs = sourcesByItem.filter((s) => s.itemId === it.id);
    const repo = (it.meta as { repo?: unknown }).repo;
    return [
      `ref: i${i}`,
      `kind: ${it.kind}`,
      `published: ${it.publishedAt?.toISOString().slice(0, 10) ?? "unknown"}`,
      `reports: ${srcs.length} (${[...new Set(srcs.map((s) => s.publisher ?? hostOf(s.url)))].join(", ")})${srcs.some((s) => s.isPrimary) ? " — includes primary/official source" : ""}`,
      repo ? "repo stats are measured from the GitHub API" : "",
      untrusted(srcs[0]?.publisher ?? "feed", `${it.title}\n${it.excerpt ?? ""}\n${srcs.slice(1, 3).map((s) => `Also reported: ${s.title}`).join("\n")}`, 1400),
    ]
      .filter(Boolean)
      .join("\n");
  });
  const out = await runTask({
    task: "analyze_batch",
    promptVersion: PROMPT_VERSIONS.analyze,
    tier: "routine",
    system: analysisSystem(JSON.stringify(prefs.interests), prefs.aboutMe),
    user: `Today is ${new Date().toISOString().slice(0, 10)}. Analyze each item. Return one entry per ref.\n\n${blocks.join("\n\n---\n\n")}`,
    output: analysisBatchSchema,
    maxTokens: Math.min(16000, 900 * batch.length + 1500),
    temperature: 0.2,
    budget: prefs.llm,
  });
  return out.items;
}

/** If a batch is cut off at max_tokens, analyze each half separately (down to single items). */
async function analyzeWithSplit(batch: Item[], prefs: Preferences): Promise<{ item: Item; a: AnalysisItem }[]> {
  try {
    const out = await analyzeBatch(batch, prefs);
    return batch.flatMap((item, idx) => {
      const a = out.find((r) => r.ref === `i${idx}`);
      return a ? [{ item, a }] : [];
    });
  } catch (err) {
    if (err instanceof LLMError && err.code === "truncated" && batch.length > 1) {
      const mid = Math.ceil(batch.length / 2);
      return [...(await analyzeWithSplit(batch.slice(0, mid), prefs)), ...(await analyzeWithSplit(batch.slice(mid), prefs))];
    }
    throw err;
  }
}

export async function storeAnalysis(
  item: Item,
  a: AnalysisItem,
  prefs: Preferences,
  now: Date,
  recentlyCovered: { title: string }[],
  categorySignals: Map<string, number> = new Map(),
) {
  const srcs = await db().query.itemSources.findMany({ where: eq(schema.itemSources.itemId, item.id) });
  const hasPrimary = srcs.some((s) => s.isPrimary);
  // Learned from what the user saved, approved, published, or dismissed in this category.
  const learned = Math.max(-1, Math.min(1, (categorySignals.get(a.category.toLowerCase()) ?? 0) * 0.15));
  const factors = {
    relevance: Math.max(0, Math.min(5, a.scores.relevance + learned)),
    recency: recencyScore(item.publishedAt, now, a.timeliness),
    evidence: evidenceScore(a.scores.evidence, srcs.length, hasPrimary, a.facts.length),
    insight: a.scores.insight,
    audience: a.scores.audience,
  };
  const penalties: Penalty[] = [];
  const repeat = recentlyCovered.find((r) => titleSimilarity(r.title, a.headline) >= 0.4 || titleSimilarity(r.title, item.title) >= 0.4);
  if (repeat) penalties.push({ code: "repeat_topic", multiplier: 0.6, note: `similar to recent "${repeat.title.slice(0, 60)}"` });
  if (!hasPrimary && srcs.length === 1 && a.facts.length === 0) penalties.push({ code: "low_evidence", multiplier: 0.8, note: "single source with no concrete facts" });
  const total = totalScore(factors, prefs.weights, penalties);
  const explanation = explainScore(factors, total, penalties, { relevance: a.relevanceReason });

  const verification = hasPrimary ? "primary_source" : srcs.length >= 2 ? "multi_source" : "single_source";
  await db().transaction(async (tx) => {
    await tx
      .update(schema.items)
      .set({
        status: "analyzed",
        category: a.category,
        timeliness: a.timeliness,
        analysis: {
          headline: a.headline,
          summary: a.summary,
          whyItMatters: a.whyItMatters,
          opportunity: a.opportunity,
          whyPost: a.whyPost,
          facts: a.facts,
          interpretation: a.interpretation,
          uncertainty: a.uncertainty,
          platforms: a.platforms,
          relevanceReason: a.relevanceReason,
          eventKey: a.eventKey,
        },
        analysisVersion: PROMPT_VERSIONS.analyze,
        score: total,
      })
      .where(eq(schema.items.id, item.id));
    await tx.insert(schema.scores).values({ itemId: item.id, version: SCORE_VERSION, ...factors, penalties, weights: prefs.weights, total, explanation });
    await tx.delete(schema.claims).where(eq(schema.claims.itemId, item.id));
    for (const f of a.facts) {
      const [c] = await tx.insert(schema.claims).values({ itemId: item.id, text: f, kind: "fact", verification }).returning();
      for (const s of srcs.slice(0, 3)) await tx.insert(schema.claimEvidence).values({ claimId: c.id, itemSourceId: s.id, url: s.url });
    }
    for (const t of a.interpretation) await tx.insert(schema.claims).values({ itemId: item.id, text: t, kind: "interpretation", verification: "unverified" });
  });
  return total;
}

async function analyzeCandidates(userId: string, prefs: Preferences, now: Date, stats: RunStats) {
  if (!prefs.llm.enabled) {
    stats.llm = "disabled";
    return;
  }
  if (!llmConfigured()) {
    stats.llm = "not_configured";
    return;
  }
  const pool = await db().query.items.findMany({
    where: and(eq(schema.items.status, "new"), gte(schema.items.firstSeenAt, new Date(now.getTime() - 3 * 86_400_000))),
    orderBy: [desc(schema.items.prefilterScore), desc(schema.items.publishedAt)],
    limit: prefs.llm.maxItemsAnalyzedPerRun * 3,
  });
  // Keep the mix diverse: repositories may take at most ~30% of the model budget.
  const maxRepos = Math.ceil(prefs.llm.maxItemsAnalyzedPerRun * 0.3);
  const candidates: Item[] = [];
  let repos = 0;
  for (const it of pool) {
    if (candidates.length >= prefs.llm.maxItemsAnalyzedPerRun) break;
    if (it.kind === "repo" && repos >= maxRepos) continue;
    if (it.kind === "repo") repos++;
    candidates.push(it);
  }
  const covered = await recentlyCoveredTitles(prefs, now);
  const signals = await feedbackSignals(userId, now);
  for (let i = 0; i < candidates.length; i += prefs.llm.batchSize) {
    const batch = candidates.slice(i, i + prefs.llm.batchSize);
    let results: { item: Item; a: AnalysisItem }[];
    try {
      results = await analyzeWithSplit(batch, prefs);
    } catch (err) {
      stats.llm = err instanceof LLMError && err.code === "budget" ? "budget" : "error";
      stats.llmError = (err as Error).message;
      log.warn("analysis_batch_failed", { error: (err as Error).message });
      return; // stop spending; remaining items stay "new" for the next run
    }
    for (const { item: it, a } of results) {
      if (a.skip) {
        await db().update(schema.items).set({ status: "filtered", filterReason: `model: ${a.skipReason ?? "not relevant"}`, category: a.category }).where(eq(schema.items.id, it.id));
        stats.skippedByModel++;
        continue;
      }
      await storeAnalysis(it, a, prefs, now, covered, signals);
      stats.analyzed++;
    }
  }
}

/** Titles of things already briefed, saved, or drafted recently: used to avoid repeating topics. */
async function recentlyCoveredTitles(prefs: Preferences, now: Date) {
  const since = new Date(now.getTime() - prefs.briefing.repeatWindowDays * 86_400_000);
  const briefed = await db()
    .select({ title: schema.items.title, analysis: schema.items.analysis })
    .from(schema.briefingItems)
    .innerJoin(schema.briefings, eq(schema.briefings.id, schema.briefingItems.briefingId))
    .innerJoin(schema.items, eq(schema.items.id, schema.briefingItems.itemId))
    .where(gte(schema.briefings.createdAt, since));
  const drafted = await db()
    .select({ title: schema.items.title, analysis: schema.items.analysis, kind: schema.items.kind })
    .from(schema.drafts)
    .innerJoin(schema.items, eq(schema.items.id, schema.drafts.itemId))
    .where(gte(schema.drafts.createdAt, since));
  return [...briefed, ...drafted].map((r) => ({ title: (r.analysis as { headline?: string } | null)?.headline ?? r.title }));
}

// ---------------------------------------------------------------------------
// 10. Daily briefing

/** Fallback when the model gave no event key: two titles sharing 2+ significant words, one of them distinctive. */
export function likelySameEvent(a: string, b: string) {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  const shared = [...ta].filter((t) => tb.has(t));
  return shared.length >= 2 && shared.some((t) => t.length >= 7);
}

/** Same real-world event: matching model event keys, or overlapping titles/headlines. */
export function sameEvent(a: Pick<Item, "title" | "analysis"> & { kind?: string }, b: Pick<Item, "title" | "analysis"> & { kind?: string }) {
  const ka = eventKeyOf(a);
  const kb = eventKeyOf(b);
  if (ka && kb && ka === kb) return true;
  // Repositories are distinct by URL; title overlap (same owner, similar blurbs) is not the same event.
  if (a.kind === "repo" || b.kind === "repo") return false;
  const ha = (a.analysis as { headline?: string } | null)?.headline;
  const hb = (b.analysis as { headline?: string } | null)?.headline;
  return [a.title, ha].some((x) => x && [b.title, hb].some((y) => y && likelySameEvent(x, y)));
}

function eventKeyOf(it: Pick<Item, "analysis">): string | null {
  const k = (it.analysis as { eventKey?: string } | null)?.eventKey?.trim().toLowerCase();
  return k ? k.replace(/[^a-z0-9]+/g, "-") : null;
}

/** Model categories are free text ("AI safety", "AI safety and governance"): compare on the first two words. */
export function categoryKey(category: string | null) {
  return (category ?? "other").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && w !== "and").slice(0, 2).join(" ");
}
// ---------------------------------------------------------------------------

export async function buildBriefing(userId: string, prefs: Preferences, now: Date, jobRunId?: string) {
  const localDate = DateTime.fromJSDate(now, { zone: prefs.timezone }).toISODate()!;
  const startOfToday = DateTime.fromJSDate(now, { zone: prefs.timezone }).startOf("day").toJSDate();
  // Items shown in briefings on previous days are not repeated.
  const shownBefore = await db()
    .selectDistinct({ itemId: schema.briefingItems.itemId })
    .from(schema.briefingItems)
    .innerJoin(schema.briefings, eq(schema.briefings.id, schema.briefingItems.briefingId))
    .where(lt(schema.briefings.createdAt, startOfToday));
  const exclude = new Set(shownBefore.map((r) => r.itemId));

  const pool = await db().query.items.findMany({
    where: and(
      eq(schema.items.status, "analyzed"),
      or(
        gte(schema.items.firstSeenAt, new Date(now.getTime() - 3 * 86_400_000)),
        and(eq(schema.items.timeliness, "evergreen"), gte(schema.items.firstSeenAt, new Date(now.getTime() - 14 * 86_400_000))),
      ),
      gte(schema.items.score, prefs.briefing.minScore),
    ),
    orderBy: desc(schema.items.score),
    limit: 100,
  });
  const picked: Item[] = [];
  const perCat = new Map<string, number>();
  let repos = 0;
  for (const it of pool) {
    if (exclude.has(it.id) || isStale(it, prefs, now)) continue;
    // Keep the briefing varied: at most two GitHub repositories.
    if (it.kind === "repo" && repos >= 2) continue;
    const cat = categoryKey(it.category);
    if ((perCat.get(cat) ?? 0) >= prefs.briefing.maxPerCategory) continue;
    if (picked.some((p) => titleSimilarity(p.title, it.title) >= SAME_STORY_THRESHOLD)) continue;
    // Different reports of the same event (the model names the event) appear only once.
    const ev = eventKeyOf(it);
    if (ev && picked.some((p) => eventKeyOf(p) === ev)) continue;
    if (picked.some((p) => sameEvent(p, it))) continue;
    picked.push(it);
    if (it.kind === "repo") repos++;
    perCat.set(cat, (perCat.get(cat) ?? 0) + 1);
    if (picked.length >= prefs.briefing.maxItems) break;
  }

  const [b] = await db()
    .insert(schema.briefings)
    .values({
      localDate,
      jobRunId: jobRunId ?? null,
      note: picked.length < 3 ? "A quiet day: fewer strong candidates than usual." : null,
    })
    .returning();
  if (picked.length) {
    await db().insert(schema.briefingItems).values(picked.map((it, i) => ({ briefingId: b.id, itemId: it.id, rank: i + 1 })));
  }
  return { briefingId: b.id, count: picked.length };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function runDiscovery(userId: string, opts: { force?: boolean; jobRunId?: string; now?: Date } = {}): Promise<RunStats> {
  const now = opts.now ?? new Date();
  const prefs = await getUserPreferences(userId);
  const stats: RunStats = {
    sourcesPolled: 0,
    sourceErrors: [],
    collected: 0,
    newItems: 0,
    mergedReports: 0,
    filtered: 0,
    analyzed: 0,
    skippedByModel: 0,
    briefed: 0,
    llm: "ok",
  };

  const sources = await db().query.sources.findMany({ where: eq(schema.sources.enabled, true) });
  const due = sources.filter(
    (s) => opts.force || !s.lastPolledAt || now.getTime() - s.lastPolledAt.getTime() >= s.pollIntervalMinutes * 60_000 * 0.9,
  );

  // Poll with small concurrency, but never two sources on the same host at once: several feeds
  // share a host (Reddit, GitHub's search API) and rate-limit bursts, so those are serialized.
  const byHost = new Map<string, typeof due>();
  for (const s of due) {
    let host = s.url;
    try {
      host = new URL(s.url).host;
    } catch {}
    const list = byHost.get(host);
    if (list) list.push(s);
    else byHost.set(host, [s]);
  }
  const hostQueue = [...byHost.values()];
  const workers = Array.from({ length: 4 }, async () => {
    while (hostQueue.length) {
      const group = hostQueue.shift()!;
      for (const s of group) {
        try {
          const entries = await collectSource(s);
          stats.collected += entries.length;
          const r = await ingest(entries, now);
          stats.newItems += r.created;
          stats.mergedReports += r.merged;
          await db().update(schema.sources).set({ lastPolledAt: now, lastError: null }).where(eq(schema.sources.id, s.id));
        } catch (err) {
          const msg = (err as Error).message.slice(0, 300);
          stats.sourceErrors.push({ source: s.name, error: msg });
          await db().update(schema.sources).set({ lastPolledAt: now, lastError: msg }).where(eq(schema.sources.id, s.id));
        }
        stats.sourcesPolled++;
      }
    }
  });
  await Promise.all(workers);

  stats.filtered = await filterNew(prefs, now);
  await analyzeCandidates(userId, prefs, now, stats);
  const b = await buildBriefing(userId, prefs, now, opts.jobRunId);
  stats.briefed = b.count;
  stats.autoDrafted = await autoDraftTop(userId, prefs, b.briefingId, stats);
  return stats;
}

/**
 * Pre-write posts for the best new ideas so they wait on Home as ready-to-approve drafts.
 * Skips items that already have drafts; stops on the first AI budget/config problem.
 */
export async function autoDraftTop(userId: string, prefs: Preferences, briefingId: string, stats: RunStats) {
  if (!prefs.autoDraft.enabled || prefs.autoDraft.perRun === 0 || stats.llm !== "ok" || !llmConfigured()) return 0;
  const rows = await db()
    .select({ item: schema.items })
    .from(schema.briefingItems)
    .innerJoin(schema.items, eq(schema.items.id, schema.briefingItems.itemId))
    .where(eq(schema.briefingItems.briefingId, briefingId))
    .orderBy(schema.briefingItems.rank);
  let drafted = 0;
  // Never suggest two posts about the same event (including ones drafted on earlier days).
  const recentDrafted = await db()
    .select({ title: schema.items.title, analysis: schema.items.analysis, kind: schema.items.kind })
    .from(schema.drafts)
    .innerJoin(schema.items, eq(schema.items.id, schema.drafts.itemId))
    .where(gte(schema.drafts.createdAt, new Date(Date.now() - 7 * 86_400_000)));
  for (const { item } of rows) {
    if (drafted >= prefs.autoDraft.perRun) break;
    if (item.status === "dismissed") continue;
    const existing = await db().query.drafts.findFirst({ where: eq(schema.drafts.itemId, item.id) });
    if (existing) continue;
    if (recentDrafted.some((r) => sameEvent(r, item))) continue;
    const suggested = ((item.analysis as { platforms?: ("linkedin" | "x")[] } | null)?.platforms ?? []).filter((p) => p === "linkedin" || p === "x");
    const results = await generateDrafts(userId, { itemId: item.id }, suggested.length ? suggested : ["linkedin", "x"]);
    if (results.some((r) => r.draftId)) {
      drafted++;
      recentDrafted.push({ title: item.title, analysis: item.analysis, kind: item.kind });
    }
    const err = results.find((r) => r.error);
    if (err && /budget|limit|configured|turned off/i.test(err.error!)) break;
  }
  return drafted;
}

/** Items to show when the model is unavailable: best prefiltered, clearly labelled as unanalyzed. */
export async function unanalyzedHighlights(limit = 8) {
  return db().query.items.findMany({
    where: and(eq(schema.items.status, "new"), isNull(schema.items.analysis), gte(schema.items.firstSeenAt, new Date(Date.now() - 3 * 86_400_000))),
    orderBy: [desc(schema.items.prefilterScore), desc(schema.items.publishedAt)],
    limit,
  });
}
