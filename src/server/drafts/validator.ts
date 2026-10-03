/**
 * Quality validator: deterministic checks that run on every saved revision.
 * Warnings only — nothing here blocks a save. They surface in the review UI
 * exactly where the user decides whether to publish.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/client";

export interface QualityIssue {
  code: string;
  severity: "warn" | "info";
  message: string;
}

const BANNED: [RegExp, string][] = [
  [/\bdelve into\b/i, "delve into"],
  [/\bgame[- ]chang(er|ing)\b/i, "game-changer"],
  [/\brevolutionary\b/i, "revolutionary"],
  [/\bgroundbreaking\b/i, "groundbreaking"],
  [/\bunprecedented\b/i, "unprecedented"],
  [/\bmassive\b/i, "massive"],
  [/\blet that sink in\b/i, "let that sink in"],
  [/\bin today's (fast[- ]moving|ever[- ]changing|digital)\b/i, "in today's fast-moving…"],
  [/\bthoughts\?/i, "Thoughts?"],
  [/\bagree\?/i, "Agree?"],
  [/\bthis changes everything\b/i, "this changes everything"],
  [/\bshifting the landscape\b/i, "shifting the landscape"],
  [/\bparadigm shift\b/i, "paradigm shift"],
  [/\bseamless(ly)?\b/i, "seamless"],
  [/\bleverag(e|ing)\b/i, "leverage"],
  [/\bunlock(ing)? the (full )?potential\b/i, "unlock the potential"],
  [/\bhere'?s the thing\b/i, "here's the thing"],
  [/\bbuckle up\b/i, "buckle up"],
  [/\bin conclusion\b/i, "in conclusion"],
  [/\bexcited to share\b/i, "excited to share"],
  [/\bwe'?re thrilled\b/i, "we're thrilled"],
];

const QUOTE_RE = /[“"]([^”"]{40,600})[”"]/g;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const URL_RE = /https?:\/\/\S+/;

export function qualityIssues(parts: string[], platform: "x" | "linkedin", recentTexts: string[] = []): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const all = parts.join("\n\n");

  for (const [re, label] of BANNED) {
    if (re.test(all)) issues.push({ code: "slop", severity: "warn", message: `Cliché phrasing: "${label}" — say it in specific words instead.` });
  }

  parts.forEach((p, i) => {
    const q = (p.match(/\?/g) ?? []).length;
    if (q > 1) {
      issues.push({
        code: "questions",
        severity: "warn",
        message: `${parts.length > 1 ? `Post ${i + 1} asks` : "This post asks"} ${q} questions. More than one reads as engagement bait — keep the one you actually care about.`,
      });
    }
  });

  for (const m of all.matchAll(QUOTE_RE)) {
    const words = m[1].trim().split(/\s+/).length;
    if (words > 45) {
      issues.push({ code: "quote_length", severity: "warn", message: `A quoted passage is ${words} words. Keep verbatim quotes under ~40 words for fair use.` });
      break;
    }
  }

  const tags = all.match(HASHTAG_RE) ?? [];
  if (tags.length > 2) issues.push({ code: "hashtags", severity: "warn", message: `${tags.length} hashtags — two or fewer.` });

  const emoji = all.match(EMOJI_RE) ?? [];
  if (emoji.length > 2) issues.push({ code: "emoji", severity: "warn", message: `${emoji.length} emoji — keep it to 0-2, used with meaning.` });

  if (platform === "x" && URL_RE.test(all)) {
    issues.push({
      code: "link_cost",
      severity: "info",
      message:
        "Contains a link: X bills ~$0.20 for any post with a URL — and demotes link posts in the feed. Link-in-reply keeps the main post cheap and un-demoted; the reply itself still bills as a link post.",
    });
  }

  if (recentTexts.length) {
    for (const [i, r] of recentTexts.entries()) {
      if (textSimilarity(all, r) >= 0.55) {
        issues.push({ code: "duplicate", severity: "warn", message: "Reads very close to something you posted or approved recently." });
        break;
      }
    }
  }

  // Dedupe by code+message.
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.code}:${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Bigram Jaccard similarity over word tokens — cheap and good enough for near-duplicate warnings. */
export function textSimilarity(a: string, b: string): number {
  const toks = (s: string) =>
    s
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^a-z0-9\s']/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
  const A = toks(a);
  const B = toks(b);
  if (A.length < 5 || B.length < 5) return 0;
  const grams = (arr: string[]) => {
    const set = new Set<string>();
    for (let i = 0; i < arr.length - 1; i++) set.add(`${arr[i]} ${arr[i + 1]}`);
    return set;
  };
  const GA = grams(A);
  const GB = grams(B);
  let inter = 0;
  for (const g of GA) if (GB.has(g)) inter++;
  const union = GA.size + GB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Convenience wrapper that pulls recent revision texts for the same user + platform. */
export async function qualityFor(userId: string, platform: "x" | "linkedin", parts: string[]): Promise<QualityIssue[]> {
  let recent: string[] = [];
  try {
    const rows = await db()
      .select({ parts: schema.draftRevisions.parts })
      .from(schema.draftRevisions)
      .innerJoin(schema.drafts, eq(schema.drafts.id, schema.draftRevisions.draftId))
      .where(
        and(
          eq(schema.drafts.userId, userId),
          eq(schema.drafts.platform, platform),
          inArray(schema.drafts.status, ["approved", "scheduled", "publishing", "published"]),
        ),
      )
      .orderBy(desc(schema.draftRevisions.createdAt))
      .limit(20);
    recent = rows.map((r) => r.parts.join("\n\n"));
  } catch {
    recent = [];
  }
  return qualityIssues(parts, platform, recent);
}
