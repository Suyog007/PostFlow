// Finds the best 10 to 20 sources for one person: journals, research, trade magazines, regulators and
// news for their field, specialty and country. One AI request picks from the trusted list and may add a
// few well-known sources the list lacks; every pick is fetched and kept only if its feed really works.

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { getSettings } from "./settings";
import { uid } from "./context";
import { entitlementFor } from "./billing/plans";
import { llmConfigured, runTask } from "./llm";
import { checkFeed, discoverFeed } from "./feed-discover";
import { addEvent } from "./events";
import { log } from "./log";
import { fieldOf } from "../lib/fields";
import { arxivFeed, catalogFor, MEDRXIV_SUBJECTS, medrxivFeed, type CatalogSource, type SourceKind } from "../lib/source-catalog";

/** How many sources a new account should end up with, if the plan has room. */
export const TARGET = 18;
const KIND_LABEL: Record<SourceKind, string> = { journal: "Journal", research: "Research", magazine: "Magazine", official: "Official", news: "News" };

const picked = z.object({
  picks: z.array(z.string()).max(20),
  extra: z.array(z.object({ name: z.string(), url: z.string(), kind: z.enum(["journal", "research", "magazine", "official", "news"]) })).max(6).default([]),
  medrxiv_subjects: z.array(z.string()).max(3).default([]),
  arxiv_queries: z.array(z.string()).max(2).default([]),
});

/** Without the AI: the list's entries whose tags match the person's topics, role or country come first. */
export function rankByMatch(list: CatalogSource[], words: string[]): CatalogSource[] {
  const w = words.map((x) => x.toLowerCase()).filter(Boolean);
  const score = (c: CatalogSource) => c.tags.filter((t) => w.some((x) => x.includes(t) || t.includes(x))).length * 3 + (c.kind === "journal" || c.kind === "official" ? 1 : 0);
  return [...list].sort((a, b) => score(b) - score(a));
}

async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export interface FindResult {
  added: number;
  checked: number;
  names: string[];
}

/** Picks, checks and adds sources for the signed-in account. Safe to run again: it only fills free room. */
export async function findSources(opts: { target?: number } = {}): Promise<FindResult> {
  const userId = await uid();
  const s = await getSettings();
  const field = fieldOf(s.profile.field);
  const list = catalogFor(field.id);
  const words = [...s.profile.expertise, s.profile.role, s.profile.region, s.profile.audience];

  const existing = await db().select({ url: schema.sources.url }).from(schema.sources).where(eq(schema.sources.userId, userId));
  const have = new Set(existing.map((r) => r.url));
  const room = Math.max(0, (await entitlementFor(userId)).quota.feeds - existing.length);
  const want = Math.min(room, opts.target ?? TARGET);
  if (want <= 0) return { added: 0, checked: 0, names: [] };

  let candidates: CatalogSource[] = rankByMatch(list, words);
  const extras: { name: string; url: string; kind: SourceKind }[] = [];
  if (llmConfigured()) {
    try {
      const res = await runTask({
        task: "find_sources",
        role: "analyst",
        system: [
          "You choose news and research sources for one professional who posts on LinkedIn about their field.",
          "Pick the sources that matter most for their specialty, topics and country: peer-reviewed journals, research servers, professional magazines, regulators and serious news.",
          "Prefer the person's specialty and country over general sources. Mix kinds: at least a few journals or research sources, and at least one official body.",
          "From the list, return ids only. You may add up to 6 well-known sources the list lacks (for example the main journal or society of their specialty, or a regulator in their country); give their homepage or feed address exactly as you know it. Never invent a site.",
          field.id === "health" ? `You may also pick up to 3 medRxiv subjects from: ${MEDRXIV_SUBJECTS.join("; ")}.` : "",
          ["tech", "finance", "marketing", "education"].includes(field.id) ? "You may also give up to 2 short arXiv search phrases for their narrowest topics (for example \"zero-knowledge proofs\")." : "",
        ].filter(Boolean).join("\n"),
        user: [
          `Field: ${field.label}`,
          `Role: ${s.profile.role || "not given"}`,
          `Topics: ${s.profile.expertise.join(", ") || "not given"}`,
          `Country or city: ${s.profile.region || "not given"}`,
          `Readers: ${s.profile.audience || field.audience}`,
          `Pick between 10 and ${Math.min(20, want + 4)}.`,
          "",
          "List (id | name | kind | tags):",
          ...list.map((c) => `${c.id} | ${c.name} | ${c.kind} | ${c.tags.join(", ")}`),
        ].join("\n"),
        output: picked,
        maxTokens: 1200,
        temperature: 0.2,
      });
      const byId = new Map(list.map((c) => [c.id, c]));
      const chosen = res.picks.map((id) => byId.get(id.trim())).filter((c): c is CatalogSource => !!c);
      const research = [
        ...res.medrxiv_subjects.filter((x) => MEDRXIV_SUBJECTS.includes(x)).map(medrxivFeed),
        ...res.arxiv_queries.map((q) => q.trim()).filter((q) => q.length > 2 && q.length < 60).map(arxivFeed),
      ];
      // The AI's picks first, then the rest of the list as a fallback for picks that fail the check.
      candidates = [...research, ...chosen, ...candidates.filter((c) => !chosen.includes(c))];
      extras.push(...res.extra);
    } catch (err) {
      log.warn("find_sources_ai_failed", { error: (err as Error).message });
    }
  }

  // Check in small batches and stop once there are enough.
  const found: { name: string; url: string }[] = [];
  let checked = 0;
  const pool = [...extras.map((e) => ({ ...e, extra: true })), ...candidates.map((c) => ({ ...c, extra: false }))];
  for (let i = 0; i < pool.length && found.length < want; i += 8) {
    const batch = pool.slice(i, i + 8).filter((c) => !have.has(c.url));
    const results = await inBatches(batch, 8, async (c) => {
      checked++;
      const feed = c.extra ? await discoverFeed(c.url) : await checkFeed(c.url);
      return feed ? { name: `${c.name.slice(0, 60)} · ${KIND_LABEL[c.kind]}`, url: feed.url } : null;
    });
    for (const r of results) {
      if (!r || found.length >= want || have.has(r.url) || found.some((f) => f.url === r.url)) continue;
      found.push(r);
    }
  }

  if (found.length) {
    await db().insert(schema.sources).values(found.map((f) => ({ userId, name: f.name, url: f.url, pillar: "news" as const }))).onConflictDoNothing();
    await addEvent("sources_found", `Added ${found.length} sources for your field: ${found.slice(0, 4).map((f) => f.name.split(" · ")[0]).join(", ")}${found.length > 4 ? " and more" : ""}.`);
  }
  return { added: found.length, checked, names: found.map((f) => f.name) };
}
