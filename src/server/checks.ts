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
  const lineMax = platform === "linkedin" ? 7 : 4;
  if (body.split(/\n+/).filter((l) => l.trim()).length > lineMax) checks.push({ code: "too_many_lines", severity: "warn", message: `Keep it to a few short lines (at most ${lineMax - 1}).` });

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

/** Words that tell the reader to do something, in groups that mean the same ("patch" and "update"). A group is allowed when the source uses any of its words. */
const ADVICE: { re: RegExp; same: string[] }[] = [
  { re: /\b(upgrad\w*|updat\w*|patch\w*|install\w*)\b/i, same: ["upgrad", "updat", "patch", "install", "fixed version", "latest version"] },
  { re: /\b(rotat\w*|reset\w*|chang\w* (?:your )?(?:password|keys?|credentials))\b/i, same: ["rotat", "reset", "change your password", "new password", "revok"] },
  { re: /\b(migrat\w*|switch\w*|mov(?:e|ing) (?:to|off|away))\b/i, same: ["migrat", "switch", "move to", "moving to", "move off"] },
  { re: /\b(audit\w*|revok\w*|disabl\w*|withdraw\w*|avoid\w*)\b/i, same: ["audit", "revok", "disabl", "withdraw", "avoid"] },
  { re: /\b(stop (?:using|taking)|start taking|sell|buy|invest)\b/i, same: [] },
];
/** A sentence that addresses the reader with advice: "you should", "consider…", "make sure", "your …", or a bare command. */
const ADDRESSES_READER = /\b(you|your|you're|you'll)\b|\bconsider\b|\bmake sure\b|\bbe sure to\b|\bremember to\b|\bdon'?t forget\b|^\s*(?:now\s+)?(?:upgrade|update|patch|rotate|migrate|switch|audit|revoke|withdraw|disable|avoid|check|review|stop|start|sell|buy|invest)\b/i;

/**
 * News posts may only pass on advice the source itself gives. The writer is told this, and the reviewer is
 * told to flag it, but both have let "consider upgrading your contracts" through when no source said so.
 * Checked in code: a sentence that tells the reader to act needs the same action word in the material.
 */
/** "X should…", "consider…", "make sure…": telling someone what to do, whatever the verb. */
const GENERAL_ADVICE = /\b(should|ought to|consider(?:ing)?|make sure|be sure to|remember to|don'?t forget|it'?s (?:wise|smart|best) to|you (?:need|have) to|better to)\b/i;

const STOP = new Set("the a an and or but if then than that this these those with without from into onto for of to in on at by as is are was were be been being it its it's their they them you your we our not no so do does did can could will would should may might must have has had about over under while until".split(" "));
/** Key words of a sentence, cut to five letters so "licensing" meets "license". */
function stems(sentence: string): Set<string> {
  return new Set((sentence.toLowerCase().match(/[a-z0-9_.]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map((w) => w.slice(0, 5)));
}

/** A source sentence written as a command, the way advisories list steps ("Review SSH access policies."). */
const SOURCE_COMMAND = /^\s*(?:[-*•]\s*)?(review|disable|enable|set|apply|update|upgrade|patch|install|check|rotate|reset|revoke|restart|prepare|avoid|remove|turn|use|switch|migrate|back up|limit|restrict)\b/i;

/** A source sentence that tells someone to act ("users should update", "asks everyone to patch now"). */
const SOURCE_ADVISES = /\b(should|must|urg\w*|recommend\w*|advis\w*|asks?|asked|encourag\w*|need to|needs to|have to|has to|immediately|as soon as possible|right away|now|you|your|users|operators|customers|everyone)\b/i;

export function adviceCheck(text: string, source: string): Check[] {
  // Only sentences in the source that give advice count: "the Glamsterdam upgrade" names an event, it advises nothing.
  const src = source
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((x) => SOURCE_ADVISES.test(x) || SOURCE_COMMAND.test(x))
    .join(" ")
    .toLowerCase();
  const adviceStems = stems(src);
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean)) {
    if (!ADDRESSES_READER.test(sentence) && !GENERAL_ADVICE.test(sentence)) continue;
    // Passed on from the source: at least three key words shared with what the source advises.
    const mine = stems(sentence);
    if ([...mine].filter((w) => adviceStems.has(w)).length >= 3) continue;
    const group = ADVICE.find(({ re }) => re.test(sentence));
    if (group ? !group.same.some((w) => src.includes(w)) : GENERAL_ADVICE.test(sentence)) out.push(sentence);
  }
  return out.length
    ? [{ code: "invented_advice", severity: "block", message: `Tells readers to act in a way the source does not: "${out[0].slice(0, 140)}". Report what happened and who is affected; only pass on advice the source gives.` }]
    : [];
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
