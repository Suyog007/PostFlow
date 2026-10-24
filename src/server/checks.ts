/**
 * Deterministic checks. The reviewer model gives scores; these rules are code, so they can't be talked around.
 */
export interface Check {
  code: string;
  severity: "block" | "warn";
  message: string;
}

const BANNED: [RegExp, string][] = [
  [/\bdelve(s|d)? into\b/i, "delve into"],
  [/\bgame[- ]chang(er|ing)\b/i, "game-changer"],
  [/\brevolutionary\b/i, "revolutionary"],
  [/\bgroundbreaking\b/i, "groundbreaking"],
  [/\bunprecedented\b/i, "unprecedented"],
  [/\blet that sink in\b/i, "let that sink in"],
  [/\bin today'?s (fast[- ]paced|fast[- ]moving|ever[- ]changing|digital)\b/i, "in today's fast-paced…"],
  [/\bthoughts\?/i, "Thoughts?"],
  [/\bagree\?/i, "Agree?"],
  [/\bthis changes everything\b/i, "this changes everything"],
  [/\bparadigm shift\b/i, "paradigm shift"],
  [/\bseamless(ly)?\b/i, "seamless"],
  [/\bleverag(e|es|ing)\b/i, "leverage"],
  [/\bunlock(s|ing)? the (full )?potential\b/i, "unlock the potential"],
  [/\bhere'?s the thing\b/i, "here's the thing"],
  [/\bbuckle up\b/i, "buckle up"],
  [/\bexcited to (share|announce)\b/i, "excited to share"],
  [/\bi'?m thrilled\b/i, "I'm thrilled"],
  [/\bas an ai\b/i, "as an AI"],
  [/\bin conclusion\b/i, "in conclusion"],
];

/** Opinion templates that make a feed read as machine-written when every post uses them. */
const STOCK_OPINION: [RegExp, string][] = [
  [/\bi(?:'d| would)? expect\b/i, "I'd expect"],
  [/\bin my view\b/i, "In my view"],
  [/\ba (?:wave|surge|flood|wave of new) of\b/i, "a wave of"],
  [/\bguessing we'll see\b/i, "guessing we'll see"],
  [/\bthis could (?:lead to|pave the way)\b/i, "this could lead to"],
  [/\bit will be interesting to see\b/i, "it will be interesting to see"],
];

const URL_RE = /https?:\/\/\S+/g;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/** X counts every URL as 23 characters. */
export function weightedLength(text: string): number {
  return text.replace(URL_RE, "x".repeat(23)).length;
}

export function runChecks(text: string, platform: "x" | "linkedin", recent: string[] = []): Check[] {
  const checks: Check[] = [];
  const body = text.trim();
  if (!body) return [{ code: "empty", severity: "block", message: "The post is empty." }];

  const len = weightedLength(body);
  if (platform === "x" && len > 280) checks.push({ code: "too_long", severity: "block", message: `${len} characters; X allows 280.` });
  if (platform === "linkedin" && len > 3000) checks.push({ code: "too_long", severity: "block", message: `${len} characters; LinkedIn allows 3000.` });
  if (len < 40) checks.push({ code: "too_short", severity: "warn", message: "Very short; say what changed and what it opens up." });
  if (body.split(/\n+/).filter((l) => l.trim()).length > 4) checks.push({ code: "too_many_lines", severity: "warn", message: "Keep it to 2-3 lines." });

  const hits = BANNED.filter(([re]) => re.test(body)).map(([, l]) => l);
  if (hits.length) {
    checks.push({ code: "slop_phrases", severity: hits.length >= 2 ? "block" : "warn", message: `Cliché or machine-sounding phrasing: ${hits.join(", ")}.` });
  }
  const flat = body.replace(/[\u2018\u2019]/g, "'");
  const stock = STOCK_OPINION.filter(([re]) => re.test(flat)).map(([, l]) => `"${l}"`);
  if (stock.length) checks.push({ code: "stock_opinion", severity: "block", message: `Uses ${stock.join(", ")}, a stock phrase that makes every post sound the same. Make the point in your own words.` });
  const tagMax = platform === "linkedin" ? 3 : 2;
  if ((body.match(HASHTAG_RE) ?? []).length > tagMax) checks.push({ code: "hashtags", severity: "block", message: `More than ${tagMax} hashtags.` });
  const emojiMax = platform === "linkedin" ? 5 : 2;
  if ((body.match(EMOJI_RE) ?? []).length > emojiMax) checks.push({ code: "emoji", severity: "block", message: `More than ${emojiMax} emoji for ${platform === "x" ? "X" : "LinkedIn"}.` });
  if (platform === "linkedin" && body.split(/\n{2,}/).some((p) => p.length > 420)) checks.push({ code: "wall", severity: "warn", message: "A paragraph is too long. Keep paragraphs to 2-3 short lines." });
  if ((body.match(/\?/g) ?? []).length > 2) checks.push({ code: "questions", severity: "block", message: "Reads as engagement bait (several questions)." });

  const reused = recent.map((r) => sharedPhrase(body, r)).find(Boolean);
  if (reused) checks.push({ code: "reused_phrase", severity: "block", message: `Reuses wording from a recent post ("${reused}"). Say it differently.` });

  for (const r of recent) {
    if (textSimilarity(body, r) >= 0.5) {
      checks.push({ code: "duplicate", severity: "block", message: "Too close to a recent post." });
      break;
    }
  }
  return checks;
}

/** Bigram Jaccard similarity over word tokens: cheap and good enough for near-duplicate detection. */
export function textSimilarity(a: string, b: string): number {
  const toks = (s: string) =>
    s
      .toLowerCase()
      .replace(URL_RE, " ")
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

/** A run of `n` identical words shared with an earlier post means the writer is repeating itself. */
export function sharedPhrase(a: string, b: string, n = 6): string | null {
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(URL_RE, " ")
      .replace(/[^a-z0-9\s']/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  const A = words(a);
  const B = words(b);
  if (A.length < n || B.length < n) return null;
  const grams = new Set<string>();
  for (let i = 0; i + n <= B.length; i++) grams.add(B.slice(i, i + n).join(" "));
  for (let i = 0; i + n <= A.length; i++) {
    const g = A.slice(i, i + n).join(" ");
    if (grams.has(g)) return g;
  }
  return null;
}
