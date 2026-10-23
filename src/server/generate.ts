import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import { uid } from "./context";
import { assertPostQuota, entitlementFor, LimitError } from "./billing/plans";
import type { Pillar } from "./db/schema";
import { runTask, untrusted, LLMError } from "./llm";

/** Filter: rows that belong to the current user. */
async function mine<T extends { userId: unknown }>(t: T) {
  return eq(t.userId as never, await uid());
}
import { getSettings, saveSettings, type Settings } from "./settings";
import { REVIEWER_SYSTEM, profileBlock, writerSystem } from "./prompts";
import { runChecks, type Check } from "./checks";
import { afterQuietHours, slotsBetween, formatLocal, nextFreeSlot } from "./slots";
import { fetchArticleText } from "./net";
import { addEvent } from "./events";
import { notifyScheduled, notifyText } from "./telegram";
import { ensureVerification, type Verification } from "./verify";

type Platform = "x" | "linkedin";
const LIVE = ["scheduled", "publishing", "published", "unconfirmed", "failed", "cancelled", "expired"] as const;
const MAX_ATTEMPTS_PER_SLOT = 3;
/** After this long, earlier rejections for a slot no longer block new attempts. */
const SLOT_RETRY_AFTER_MS = 4 * 3_600_000;

export interface Material {
  kind: "news" | "note" | "evergreen";
  pillar: Pillar;
  /** Text the writer may draw facts from. */
  source: string;
  label: string;
  itemId?: string;
  noteId?: string;
  sourceUrl?: string;
  topic?: string;
  expiresAt?: Date;
  /** True when first-person experience is allowed (the owner's own note). */
  firstPerson: boolean;
  verification?: Verification;
  /** The owner's own article: its link is appended to the post (not as a "Source:" line). */
  ownUrl?: string;
}

// ---------------------------------------------------------------------------
// Material selection
// ---------------------------------------------------------------------------

const URGENCY_WINDOW_MS = { breaking: 48 * 3_600_000, week: 7 * 86_400_000 } as const;

async function usedIds(platform: Platform) {
  const rows = await db()
    .select({ itemId: schema.posts.itemId, noteId: schema.posts.noteId })
    .from(schema.posts)
    .where(and(await mine(schema.posts), eq(schema.posts.platform, platform)));
  return {
    items: new Set(rows.map((r) => r.itemId).filter((x): x is string => !!x)),
    notes: new Set(rows.map((r) => r.noteId).filter((x): x is string => !!x)),
  };
}

type ItemRow = typeof schema.items.$inferSelect;

function itemExpiry(it: ItemRow): Date | undefined {
  if (it.urgency === "breaking" || it.urgency === "week") return new Date(it.publishedAt.getTime() + URGENCY_WINDOW_MS[it.urgency]);
  return undefined;
}

async function itemMaterial(it: ItemRow, v?: Verification): Promise<Material> {
  let body = it.body;
  if (!body) {
    body = await fetchArticleText(it.url);
    if (body) await db().update(schema.items).set({ body }).where(eq(schema.items.id, it.id));
  }
  const src = it.sourceId ? await db().query.sources.findFirst({ where: eq(schema.sources.id, it.sourceId) }) : null;
  const text = [`Source: ${src?.name ?? new URL(it.url).hostname}`, `Title: ${it.title}`, `Published: ${it.publishedAt.toISOString().slice(0, 10)}`, `Summary: ${it.summary}`, body ? `Article text:\n${body}` : "(Only the headline and summary are available; do not claim details beyond them.)", v?.mentions.length ? `Also reported by (independent publishers; you may say "according to X and Y"):\n${v.mentions.map((m) => `- ${m.domain}: ${m.title}`).join("\n")}` : "", it.angle ? `Suggested angle (from an assistant, not a fact): ${it.angle}` : ""]
    .filter(Boolean)
    .join("\n");
  return { kind: "news", pillar: it.pillar, source: text, label: it.title, itemId: it.id, sourceUrl: it.url, expiresAt: itemExpiry(it), firstPerson: false, verification: v };
}

function noteMaterial(n: typeof schema.notes.$inferSelect): Material {
  return { kind: "note", pillar: n.pillar, source: n.text, label: n.text.slice(0, 80), noteId: n.id, firstPerson: true };
}

async function candidateItems(platform: Platform, s: Settings, pillar: Pillar | "any", now: Date, slotAt: Date = now) {
  const used = await usedIds(platform);
  const rows = await db()
    .select()
    .from(schema.items)
    .where(
      and(
        await mine(schema.items),
        eq(schema.items.status, "new"),
        isNotNull(schema.items.analyzedAt),
        gte(schema.items.relevance, platform === "linkedin" ? s.linkedinMinRelevance : s.minRelevance),
        gte(schema.items.publishedAt, new Date(now.getTime() - 7 * 86_400_000)),
        pillar === "any" ? undefined : eq(schema.items.pillar, pillar),
      ),
    )
    .orderBy(desc(schema.items.relevance), desc(schema.items.publishedAt))
    .limit(60);
  // Time-sensitive items must still be fresh an hour after the slot they would take.
  return rows.filter((r) => !used.items.has(r.id) && !((e) => e && e.getTime() <= slotAt.getTime() + 3_600_000)(itemExpiry(r)));
}

/** First candidate that enough independent publishers confirm. Checks are cached on the item and capped per call. */
async function pickVerified(items: ItemRow[], maxChecks = 4): Promise<{ it: ItemRow; v: Verification } | null> {
  let checks = 0;
  for (const it of items) {
    const cached = it.verification as unknown as Verification | null;
    if (!cached && ++checks > maxChecks) break;
    const v = await ensureVerification(it);
    if (v.ok) return { it, v };
  }
  return null;
}

async function pickNote(platform: Platform, pillar: Pillar) {
  const used = await usedIds(platform);
  const rows = await db().select().from(schema.notes).where(and(await mine(schema.notes), eq(schema.notes.pillar, pillar))).orderBy(asc(schema.notes.createdAt)).limit(40);
  return rows.find((n) => !used.notes.has(n.id));
}

const topicOut = z.object({ topic: z.string(), angle: z.string() });

async function pickEvergreenTopic(s: Settings, platform: Platform): Promise<Material> {
  const recent = await db()
    .select({ topic: schema.posts.topic, text: schema.posts.text })
    .from(schema.posts)
    .where(and(await mine(schema.posts), eq(schema.posts.platform, platform), eq(schema.posts.pillar, "learning")))
    .orderBy(desc(schema.posts.createdAt))
    .limit(25);
  const res = await runTask({
    task: "pick_topic",
    role: "writer",
    system: `Pick ONE specific, genuinely useful topic for an evergreen explainer post. It must sit inside the owner's expertise and teach one concrete thing a working developer can use (a technique, a mental model, a common mistake, a tool comparison). Not a news item. Not a personal story.\n${profileBlock(s)}\nDo not repeat or closely overlap any recent topic.`,
    user: `Recent topics:\n${recent.map((r) => `- ${r.topic ?? r.text.slice(0, 80)}`).join("\n") || "(none)"}`,
    output: topicOut,
    maxTokens: 300,
    temperature: 0.9,
  });
  return {
    kind: "evergreen",
    pillar: "learning",
    source: `Topic: ${res.topic}\nAngle: ${res.angle}\n(Evergreen explainer: use only well-established, widely known facts.)`,
    label: res.topic,
    topic: res.topic,
    firstPerson: false,
  };
}

async function pickByPillar(platform: Platform, pillar: Pillar, s: Settings, now: Date, slotAt: Date): Promise<Material | null> {
  if (pillar === "own_work") {
    const n = await pickNote(platform, "own_work");
    return n ? noteMaterial(n) : null;
  }
  if (pillar === "learning") {
    const n = await pickNote(platform, "learning");
    // Evergreen explainers only when the owner switched them on; otherwise only their own learning notes.
    return n ? noteMaterial(n) : s.fillerPosts ? pickEvergreenTopic(s, platform) : null;
  }
  if (pillar === "news" || pillar === "local") {
    const hit = await pickVerified(await candidateItems(platform, s, pillar, now, slotAt));
    if (hit) return itemMaterial(hit.it, hit.v);
    if (pillar === "local") {
      const n = await pickNote(platform, "local");
      return n ? noteMaterial(n) : null;
    }
  }
  return null;
}

/** Weeks with nothing built are normal: with no unused "my work" notes, that share goes to news. */
async function effectivePillars(s: Settings, platform: Platform): Promise<Settings> {
  if (!s.pillars.own_work || (await pickNote(platform, "own_work"))) return s;
  return { ...s, pillars: { ...s.pillars, own_work: 0, news: s.pillars.news + s.pillars.own_work } };
}

/** Pillars ordered by how far they are below their target share over the recent window. */
async function pillarOrder(s: Settings, now: Date): Promise<Pillar[]> {
  const rows = await db()
    .select({ pillar: schema.posts.pillar, n: sql<number>`count(*)` })
    .from(schema.posts)
    .where(and(await mine(schema.posts), gte(schema.posts.scheduledAt, new Date(now.getTime() - 14 * 86_400_000)), notInArray(schema.posts.status, ["rejected", "cancelled"])))
    .groupBy(schema.posts.pillar);
  const counts = new Map(rows.map((r) => [r.pillar, Number(r.n)]));
  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
  const wsum = Object.values(s.pillars).reduce((a, b) => a + b, 0) || 1;
  return (Object.entries(s.pillars) as [Pillar, number][])
    .filter(([, w]) => w > 0)
    .map(([p, w]) => ({ p, deficit: w / wsum - (counts.get(p) ?? 0) / total }))
    .sort((a, b) => b.deficit - a.deficit)
    .map((x) => x.p);
}

/** At most this many time-sensitive posts per platform per day, so breaking news cannot crowd out the owner's own posts. */
const MAX_URGENT_PER_DAY = 1;

async function urgentCapReached(platform: Platform, at: Date): Promise<boolean> {
  const rows = await db()
    .select({ n: sql<number>`count(*)` })
    .from(schema.posts)
    .where(
      and(
        await mine(schema.posts),
        eq(schema.posts.platform, platform),
        isNotNull(schema.posts.expiresAt),
        eq(schema.posts.fast, false),
        notInArray(schema.posts.status, ["rejected", "cancelled", "expired"]),
        gte(schema.posts.scheduledAt, new Date(at.getTime() - 12 * 3_600_000)),
        lte(schema.posts.scheduledAt, new Date(at.getTime() + 12 * 3_600_000)),
      ),
    );
  return Number(rows[0].n) >= MAX_URGENT_PER_DAY;
}

/** Time-sensitive verified items first (soonest to go stale), otherwise rotate pillars. Returns null when nothing is worth posting. */
export async function chooseMaterial(platform: Platform, slotAt: Date, s: Settings, now = new Date()): Promise<Material | null> {
  const capped = await urgentCapReached(platform, slotAt);
  const urgent = (capped ? [] : await candidateItems(platform, s, "any", now, slotAt))
    .map((it) => ({ it, exp: itemExpiry(it) }))
    .filter((x): x is { it: ItemRow; exp: Date } => !!x.exp && x.exp.getTime() > slotAt.getTime() + 3_600_000)
    .sort((a, b) => a.exp.getTime() - b.exp.getTime())
    .map((x) => x.it);
  const hit = await pickVerified(urgent);
  if (hit) return itemMaterial(hit.it, hit.v);
  const order = await pillarOrder(await effectivePillars(s, platform), now);
  for (const p of order) {
    const m = await pickByPillar(platform, p, s, now, slotAt);
    if (m) return m;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Writer and reviewer
// ---------------------------------------------------------------------------

/** Ways to make the point in a news post. Rotated so the feed does not read like one template. */
export const MOVES = {
  reaction: "Your honest first reaction: what is surprising, clever, overdue or odd about it, and why, in one breath.",
  who: "Who this actually helps, named concretely (a solo dev with a side project, a two-person SaaS, an agency), and what changes for them.",
  catch: "The catch: a trade-off, limit, cost or thing to check before relying on it. Fair, not cynical.",
  try: "The first small thing you would try with it, as a concrete experiment.",
  before: "How people handled this before, and what this replaces or makes easier.",
  dry: "A short, dry, slightly wry observation about it. Clever, not a joke for its own sake.",
  guess: "A guess about what builders will do next, worded freshly and clearly as a guess (no stock phrases).",
} as const;
export type Move = keyof typeof MOVES;

/** A move not used by the last few posts, so consecutive posts take different shapes. */
async function pickMove(): Promise<Move> {
  const rows = await db()
    .select({ review: schema.posts.review })
    .from(schema.posts)
    .where(and(await mine(schema.posts), inArray(schema.posts.status, ["scheduled", "publishing", "published", "unconfirmed"])))
    .orderBy(desc(schema.posts.createdAt))
    .limit(4);
  const used = new Set(rows.map((r) => (r.review as { move?: string } | null)?.move).filter(Boolean));
  const options = (Object.keys(MOVES) as Move[]).filter((k) => !used.has(k));
  const pool = options.length ? options : (Object.keys(MOVES) as Move[]);
  return pool[Math.floor(Math.random() * pool.length)];
}

const writerOut = z.object({
  text: z.string(),
  /** For the fact-checker only, never posted: the words in the material behind each factual claim. */
  evidence: z.array(z.object({ claim: z.string(), quote: z.string() })).optional(),
});

export interface Evidence {
  claim: string;
  quote: string;
  /** Set by code: the quote really appears in the material. */
  found: boolean;
}

const normQuote = (t: string) =>
  t
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/** True when every part of the quote (split on "...") appears word for word in the material. */
export function quoteInSource(quote: string, source: string): boolean {
  const src = normQuote(source);
  const parts = normQuote(quote)
    .replace(/^["']+|["']+$/g, "")
    .split(/\s*(?:\.\.\.|\u2026)\s*/)
    .map((x) => x.replace(/^[\s.,;:"']+|[\s.,;:"']+$/g, ""))
    .filter((x) => x.length >= 4);
  return parts.length > 0 && parts.every((x) => src.includes(x));
}

function describeMaterial(m: Material): string {
  if (m.kind === "note") return `OWNER NOTE (first-person claims allowed only as stated here):\n${m.source}`;
  if (m.kind === "evergreen") return `ASSIGNMENT:\n${m.source}`;
  return `SOURCE MATERIAL:\n${untrusted("article", m.source, 7000)}`;
}

function sanitize(text: string): string {
  return text
    .replace(/\s+—\s+/g, ", ")
    .replace(/—/g, "-")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function write(m: Material, platform: Platform, s: Settings, recent: string[], feedback?: { previous: string; notes: string[] }, move?: Move): Promise<{ text: string; evidence: Evidence[] }> {
  // Recent posts come first and are labelled as style-only: placed after the material, the model sometimes wrote about them instead.
  const user = [
    recent.length ? `STYLE CONTRAST ONLY (your recent posts; NOT material for this post, never write about their subjects). Do not reuse their openings, phrases or structure:\n${recent.slice(0, 8).map((r) => `- ${r.replace(/\s+/g, " ").slice(0, 140)}`).join("\n")}\n` : "",
    describeMaterial(m),
    feedback ? `\nYour previous draft:\n"""${feedback.previous}"""\nAn editor rejected it for these reasons. Fix every one, keep what worked, do not add new facts:\n${feedback.notes.map((n) => `- ${n}`).join("\n")}` : "",
    m.kind === "news" && move ? `\nTHIS POST'S MOVE (how to make your point this time): ${MOVES[move]}` : "",
    "\nWrite the post about the material above and nothing else.",
  ].join("\n");
  const res = await runTask({ task: "write_post", role: "writer", system: writerSystem(s, platform), user, output: writerOut, maxTokens: 1200, temperature: 0.7 });
  const evidence = (res.evidence ?? []).slice(0, 10).map((e) => ({ claim: e.claim.slice(0, 300), quote: e.quote.slice(0, 500), found: quoteInSource(e.quote, m.source) }));
  return { text: sanitize(res.text), evidence };
}

const reviewOut = z.object({
  worth_posting: z.number().min(0).max(10),
  factual: z.number().min(0).max(10),
  slop: z.number().min(0).max(10),
  claims: z.array(z.object({ claim: z.string(), support: z.enum(["supported", "unsupported", "unverifiable"]), evidence: z.string() })),
  issues: z.array(z.string()),
  revision_instructions: z.string(),
  is_duplicate: z.boolean(),
});
export type Review = z.infer<typeof reviewOut>;

async function review(m: Material, text: string, platform: Platform, recent: string[], extra: { evidence?: Evidence[]; earlier?: string[]; effort?: string } = {}): Promise<Review> {
  const user = [
    `Platform: ${platform === "x" ? "X" : "LinkedIn"}`,
    describeMaterial(m),
    `DRAFT:\n"""${text}"""`,
    extra.evidence?.length
      ? `WRITER'S EVIDENCE (not part of the post; where the writer says each claim comes from. Code checked each quote against the material: FOUND = the exact words are there, NOT FOUND = they are not):\n${extra.evidence.map((e) => `- claim: ${e.claim}\n  quote: "${e.quote}" [${e.found ? "FOUND" : "NOT FOUND"}]`).join("\n")}`
      : "",
    extra.earlier?.length
      ? `A FIRST REVIEWER HELD THIS DRAFT BACK FOR THESE REASONS. Check each one against the material. Keep the ones that are right; drop the ones that are wrong (for example, a take plainly in the owner's voice is not a claim of fact). Do not invent new problems to replace them:\n${extra.earlier.map((x) => `- ${x}`).join("\n")}`
      : "",
    `RECENT POSTS (for duplicate detection):\n${recent.slice(0, 10).map((r) => `- ${r.replace(/\s+/g, " ").slice(0, 200)}`).join("\n") || "(none)"}`,
  ];
  // Room for the model's reasoning as well as the JSON answer.
  return runTask({ task: extra.earlier !== undefined ? "recheck_post" : "review_post", role: "reviewer", system: REVIEWER_SYSTEM, user: user.filter(Boolean).join("\n\n"), output: reviewOut, maxTokens: 4000, temperature: 0.1, reasoningEffort: extra.effort });
}

export interface Verdict {
  approved: boolean;
  reasons: string[];
}

/** The decision is code, not the model: scores are inputs, thresholds are ours. */
export function gate(r: Review, checks: Check[], m: Material): Verdict {
  const reasons: string[] = [];
  if (r.worth_posting < 7) reasons.push(`Not worth posting (${r.worth_posting}/10): ${r.issues[0] ?? "too generic"}`);
  if (r.factual < 8) reasons.push(`Facts not solid enough (${r.factual}/10).`);
  const unsupported = r.claims.filter((c) => c.support === "unsupported");
  for (const c of unsupported) reasons.push(`Unsupported claim: "${c.claim}"`);
  const unverifiable = r.claims.filter((c) => c.support === "unverifiable");
  if (unverifiable.length > (m.kind === "evergreen" ? 1 : 0)) reasons.push(`Unverifiable claim(s): ${unverifiable.map((c) => `"${c.claim}"`).join("; ")}`);
  if (r.slop < 7) reasons.push(`Reads like AI slop (${r.slop}/10).`);
  if (r.is_duplicate) reasons.push("Repeats a recent post.");
  for (const c of checks.filter((c) => c.severity === "block")) reasons.push(c.message);
  return { approved: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Producing one post for a slot
// ---------------------------------------------------------------------------

async function recentTexts(platform: Platform) {
  const rows = await db()
    .select({ text: schema.posts.text })
    .from(schema.posts)
    .where(and(await mine(schema.posts), eq(schema.posts.platform, platform), inArray(schema.posts.status, ["scheduled", "published", "publishing", "unconfirmed"])))
    .orderBy(desc(schema.posts.scheduledAt))
    .limit(25);
  return rows.map((r) => r.text);
}

function withLink(text: string, m: Material, platform: Platform, s: Settings): string {
  if (!m.sourceUrl || !s.includeLinks[platform]) return text;
  const withUrl = platform === "linkedin" ? `${text}\n\nSource: ${m.sourceUrl}` : `${text} ${m.sourceUrl}`;
  return platform === "x" && runChecks(withUrl, "x").some((c) => c.code === "too_long") ? text : withUrl;
}

export interface Produced {
  status: "scheduled" | "rejected" | "draft";
  postId: string;
  reasons: string[];
}

export async function produceForSlot(platform: Platform, at: Date, m: Material, s: Settings, maxRounds = 3, opts: { fast?: boolean; requested?: "schedule" | "draft" } = {}): Promise<Produced> {
  await assertPostQuota();
  const userId = await uid();
  const recent = await recentTexts(platform);
  // For your own article the link is part of the post, so length checks and the reviewer see it.
  const compose = (t: string) => (m.ownUrl ? (platform === "linkedin" ? `${t}\n\n${m.ownUrl}` : `${t} ${m.ownUrl}`) : t);
  const move = m.kind === "news" ? await pickMove() : undefined;
  let w = await write(m, platform, s, recent, undefined, move);
  let text = w.text;
  let verdict: Verdict = { approved: false, reasons: [] };
  let lastReview: Review | null = null;
  let checks: Check[] = [];
  const rounds: { text: string; reasons: string[] }[] = [];

  for (let round = 0; round < maxRounds; round++) {
    checks = runChecks(compose(text), platform, recent);
    lastReview = await review(m, compose(text), platform, recent, { evidence: w.evidence });
    verdict = gate(lastReview, checks, m);
    rounds.push({ text, reasons: verdict.reasons });
    if (verdict.approved || round === maxRounds - 1) break;
    // A story that is simply not worth posting will not be rescued by rewording; skip it.
    if (!opts.requested && lastReview.worth_posting <= 4) break;
    w = await write(m, platform, s, recent, { previous: text, notes: [...verdict.reasons, lastReview.revision_instructions].filter(Boolean) }, move);
    text = w.text;
  }

  const finalText = m.ownUrl ? compose(text) : verdict.approved ? withLink(text, m, platform, s) : text;
  // Posts you asked for are never thrown away: if the reviewer is unhappy or you wanted a draft, you get a draft.
  const status: "scheduled" | "rejected" | "draft" = opts.requested ? (verdict.approved && opts.requested === "schedule" ? "scheduled" : "draft") : verdict.approved ? "scheduled" : "rejected";
  const reviewJson = { ...lastReview, checks, verdict, evidence: w.evidence, move, rounds: rounds.length, material: { kind: m.kind, label: m.label }, verification: m.verification ?? null, reviewedAt: new Date().toISOString() } as Record<string, unknown>;
  const [row] = await db()
    .insert(schema.posts)
    .values({
      userId,
      platform,
      pillar: m.pillar,
      text: finalText,
      status: status,
      scheduledAt: at,
      expiresAt: m.expiresAt ?? null,
      itemId: m.itemId ?? null,
      noteId: m.noteId ?? null,
      topic: m.topic ?? null,
      sourceUrl: m.sourceUrl ?? null,
      fast: opts.fast ?? false,
      userEdited: !!opts.requested, // protects posts you asked for from being replaced by news
      review: reviewJson,
      error: verdict.approved ? null : `Reviewer: ${verdict.reasons.join(" | ")}`.slice(0, 500),
    })
    .returning();

  if (status === "draft") {
    await addEvent("draft", `Draft ready for ${platform === "x" ? "X" : "LinkedIn"}: ${m.label.slice(0, 80)}`, row.id);
    await notifyText(`📝 Draft ready for ${platform === "x" ? "X" : "LinkedIn"}${verdict.approved ? "" : " (the reviewer had concerns: " + verdict.reasons[0] + ")"}\n\n${finalText}\n\nOpen the app to edit it or put it on the calendar.`).catch(() => {});
  } else if (verdict.approved) {
    await addEvent("scheduled", `${opts.fast ? "Fast lane: " : ""}${platform === "x" ? "X" : "LinkedIn"} post scheduled for ${formatLocal(at, s.timezone)}: ${m.label.slice(0, 80)}`, row.id);
    const needsApproval = s.requireApproval || !(await entitlementFor(userId)).features.autoMode;
    await notifyScheduled(row, s.timezone, needsApproval).catch(() => {});
  } else {
    await addEvent("rejected", `Reviewer rejected a ${platform} draft (${m.label.slice(0, 60)}): ${verdict.reasons[0] ?? ""}`, row.id);
  }
  return { status, postId: row.id, reasons: verdict.reasons };
}

/** Rebuilds what a post was written from, so it can be rewritten without new facts. */
async function materialForPost(p: typeof schema.posts.$inferSelect): Promise<Material> {
  if (p.itemId) {
    const it = await db().query.items.findFirst({ where: and(eq(schema.items.id, p.itemId), await mine(schema.items)) });
    if (it) return itemMaterial(it, (it.verification as Verification | null) ?? undefined);
  }
  if (p.noteId) {
    const n = await db().query.notes.findFirst({ where: and(eq(schema.notes.id, p.noteId), await mine(schema.notes)) });
    if (n) return noteMaterial(n);
  }
  if (p.topic) return { kind: "evergreen", pillar: p.pillar, source: `Topic: ${p.topic}\n(Evergreen explainer: use only well-established, widely known facts.)`, label: p.topic, topic: p.topic, firstPerson: false };
  // Nothing left to draw from: the current text is the only material.
  return { kind: "note", pillar: p.pillar, source: p.text, label: p.text.slice(0, 80), firstPerson: false };
}

/**
 * The owner likes the post but not the wording. Same story and facts, new wording that follows their feedback.
 * The result goes back to "needs approval"; the reviewer re-checks facts, and its concerns are shown rather than blocking.
 */
export async function rewordPost(id: string, feedback: string, remember: boolean): Promise<{ text: string; reasons: string[] }> {
  const p = await db().query.posts.findFirst({ where: and(eq(schema.posts.id, id), await mine(schema.posts)) });
  if (!p) throw new Error("Post not found.");
  if (!["scheduled", "draft", "rejected"].includes(p.status)) throw new Error(`A ${p.status} post cannot be reworded.`);
  const note = feedback.trim().slice(0, 500);
  if (!note) throw new Error("Say what about the wording is not yours.");

  const s = await getSettings();
  if (remember && !s.styleNotes.includes(note)) {
    await saveSettings({ styleNotes: [...s.styleNotes, note].slice(-20) });
    s.styleNotes = [...s.styleNotes, note].slice(-20);
  }
  const platform = p.platform as Platform;
  const m = await materialForPost(p);
  const recent = (await recentTexts(platform)).filter((t) => t !== p.text);
  const { text, evidence } = await write(m, platform, s, recent, {
    previous: p.text,
    notes: [`The owner says the content is fine but the wording does not sound like them: "${note}"`, "Keep the same story, facts and point. Change only the wording."],
  }, (p.review as { move?: Move } | null)?.move);
  const checks = runChecks(text, platform, recent);
  const block = checks.find((c) => c.severity === "block" && (c.code === "too_long" || c.code === "empty"));
  if (block) throw new Error(`The rewrite came out unusable (${block.message}) Try again.`);
  const r = await review(m, text, platform, recent, { evidence });
  const verdict = gate(r, checks, m);
  const finalText = withLink(text, m, platform, s);
  await db()
    .update(schema.posts)
    .set({
      text: finalText,
      approvedAt: null,
      review: { ...(p.review ?? {}), ...r, checks, verdict, evidence, reworded: note, reviewedAt: new Date().toISOString() },
      error: verdict.approved ? null : `Reviewer: ${verdict.reasons.join(" | ")}`.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(schema.posts.id, id));
  await addEvent("reworded", `Reworded a ${platform} post: ${note.slice(0, 80)}`, id);
  return { text: finalText, reasons: verdict.reasons };
}

/**
 * "Check again": a second, more careful review of a post the reviewer held back. It sees the first
 * reviewer's reasons and keeps only the ones that hold up. If the post passes, it goes back on the
 * calendar (still waiting for the owner's OK when approval is on).
 */
export async function recheckPost(id: string): Promise<{ approved: boolean; message: string }> {
  const p = await db().query.posts.findFirst({ where: and(eq(schema.posts.id, id), await mine(schema.posts)) });
  if (!p) throw new Error("Post not found.");
  if (p.status !== "rejected") throw new Error("Only posts the reviewer held back can be checked again.");
  const prev = (p.review ?? {}) as { verdict?: Verdict; evidence?: Evidence[]; rechecked?: number };
  if ((prev.rechecked ?? 0) >= 2) throw new Error("This post has already been checked again twice. Reword or edit it instead.");
  if (p.expiresAt && p.expiresAt.getTime() < Date.now() + 30 * 60_000) throw new Error("This story has gone stale, so it cannot go out any more.");

  const s = await getSettings();
  const platform = p.platform as Platform;
  const m = await materialForPost(p);
  const recent = (await recentTexts(platform)).filter((t) => t !== p.text);
  const checks = runChecks(p.text, platform, recent);
  const r = await review(m, p.text, platform, recent, { evidence: prev.evidence, earlier: prev.verdict?.reasons ?? [], effort: "high" });
  const verdict = gate(r, checks, m);
  const review_ = { ...(p.review ?? {}), ...r, checks, verdict, rechecked: (prev.rechecked ?? 0) + 1, reviewedAt: new Date().toISOString() };

  if (!verdict.approved) {
    await db().update(schema.posts).set({ review: review_, error: `Reviewer (second check): ${verdict.reasons.join(" | ")}`.slice(0, 500), updatedAt: new Date() }).where(eq(schema.posts.id, id));
    await addEvent("rechecked", `Second check kept a ${platform === "x" ? "X" : "LinkedIn"} post held back: ${verdict.reasons[0] ?? ""}`.slice(0, 300), id);
    return { approved: false, message: `The second check agrees it should not go out: ${verdict.reasons[0] ?? "it did not pass"}` };
  }

  // Keep its slot if still free and far enough ahead; otherwise take the next free one before it goes stale.
  const soon = new Date(Date.now() + 20 * 60_000);
  const clash = await db()
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .where(and(await mine(schema.posts), eq(schema.posts.platform, platform), eq(schema.posts.scheduledAt, p.scheduledAt), inArray(schema.posts.status, ["scheduled", "publishing", "published", "unconfirmed"])));
  let at: Date | null = p.scheduledAt > soon && !clash.length ? p.scheduledAt : await nextFreeSlot(s, platform, soon);
  if (at && p.expiresAt && at > p.expiresAt) at = null;
  const status = at ? "scheduled" : "draft";
  await db()
    .update(schema.posts)
    .set({ status, scheduledAt: at ?? p.scheduledAt, review: review_, error: null, approvedAt: null, text: withLink(p.text, m, platform, s), updatedAt: new Date() })
    .where(eq(schema.posts.id, id));
  const when = at ? formatLocal(at, s.timezone) : null;
  await addEvent("rechecked", `Second check passed a ${platform === "x" ? "X" : "LinkedIn"} post${when ? `; scheduled for ${when}` : "; moved to drafts"}.`, id);
  return { approved: true, message: when ? `Passed the second check. Scheduled for ${when}.` : "Passed the second check. No free slot before it goes stale, so it is in your drafts." };
}

/** The owner rejected a post: drop it and write a different one for the same platform. Its story is not reused. */
export async function rejectAndReplace(id: string): Promise<{ replacementId: string | null; message: string }> {
  const p = await db().query.posts.findFirst({ where: and(eq(schema.posts.id, id), await mine(schema.posts)) });
  if (!p) throw new Error("Post not found.");
  if (!["scheduled", "draft"].includes(p.status)) throw new Error(`A ${p.status} post cannot be rejected.`);
  await db().update(schema.posts).set({ status: "declined", approvedAt: null, updatedAt: new Date() }).where(eq(schema.posts.id, id));
  await addEvent("declined", `You rejected a ${p.platform} post; looking for a different story.`, id);

  const s = await getSettings();
  const platform = p.platform as Platform;
  const now = new Date();
  // Keep the same slot unless it is too close; then take the next free one.
  const at = p.scheduledAt.getTime() > now.getTime() + 20 * 60_000 ? p.scheduledAt : await nextFreeSlot(s, platform, new Date(now.getTime() + 20 * 60_000));
  if (!at) return { replacementId: null, message: "Rejected. No free slot to put a replacement in." };
  for (let i = 0; i < MAX_ATTEMPTS_PER_SLOT; i++) {
    const m = await chooseMaterial(platform, at, s, now);
    if (!m) return { replacementId: null, message: "Rejected. Nothing else strong enough to post right now; the slot will be retried as new stories come in." };
    const out = await produceForSlot(platform, at, m, s);
    if (out.status === "scheduled") return { replacementId: out.postId, message: "Rejected. A replacement is waiting for your approval." };
  }
  return { replacementId: null, message: "Rejected. The replacements I wrote did not pass review; the slot will be retried later." };
}

// ---------------------------------------------------------------------------
// Keeping the calendar filled
// ---------------------------------------------------------------------------

/** Frees the earliest soft slot for a time-sensitive item that would otherwise go stale before any free slot. */
async function bumpForUrgent(platform: Platform, s: Settings, now: Date, freeSlots: { at: Date }[]): Promise<boolean> {
  const cands = (await candidateItems(platform, s, "any", now))
    .filter((it) => { const e = itemExpiry(it); return !!e && e.getTime() > now.getTime() + 3_600_000; })
    .sort((a, b) => itemExpiry(a)!.getTime() - itemExpiry(b)!.getTime());
  const hit = await pickVerified(cands, 3);
  if (!hit) return false;
  const urgent = itemExpiry(hit.it)!;
  const firstFree = freeSlots[0]?.at.getTime() ?? Infinity;
  if (firstFree < urgent.getTime() - 3_600_000) return false; // a free slot already works

  const victim = await db()
    .select()
    .from(schema.posts)
    .where(and(await mine(schema.posts), eq(schema.posts.platform, platform), eq(schema.posts.status, "scheduled"), eq(schema.posts.userEdited, false), isNull(schema.posts.expiresAt), gte(schema.posts.scheduledAt, new Date(now.getTime() + 30 * 60_000)), lte(schema.posts.scheduledAt, new Date(urgent.getTime() - 3_600_000))))
    .orderBy(asc(schema.posts.scheduledAt))
    .limit(1);
  if (!victim[0]) return false;
  if (await urgentCapReached(platform, victim[0].scheduledAt)) return false;
  await db().delete(schema.posts).where(eq(schema.posts.id, victim[0].id));
  await addEvent("bumped", `Replaced an evergreen ${platform} post with a time-sensitive one.`);
  return true;
}


// ---------------------------------------------------------------------------
// Fast lane: rare, high-value breaking stories get an extra post soon, outside the normal slots
// ---------------------------------------------------------------------------

const FAST_MAX_AGE_MS = 12 * 3_600_000;
const FAST_MAX_REJECTED_PER_DAY = 3; // bounds model spend when nothing passes review

async function fastLaneTime(platform: Platform, s: Settings, now: Date): Promise<Date> {
  const f = s.fastLane;
  let at = new Date(Math.ceil((now.getTime() + f.leadMinutes * 60_000) / 60_000) * 60_000);
  at = afterQuietHours(at, s.timezone, f.quietStart, f.quietEnd);
  for (let i = 0; i < 30; i++) {
    const clash = await db()
      .select({ id: schema.posts.id })
      .from(schema.posts)
      .where(and(await mine(schema.posts), eq(schema.posts.platform, platform), eq(schema.posts.scheduledAt, at), inArray(schema.posts.status, ["scheduled", "publishing"])));
    if (!clash.length) break;
    at = new Date(at.getTime() + 60_000);
  }
  return at;
}

export async function runFastLane(s: Settings, now: Date): Promise<{ produced: number; rejected: number }> {
  const out = { produced: 0, rejected: 0 };
  const f = s.fastLane;
  if (!f.enabled) return out;
  if (!(await entitlementFor(await uid())).features.fastLane) return out;
  const since = new Date(now.getTime() - 24 * 3_600_000);
  for (const platform of f.platforms) {
    const recent = await db()
      .select({ status: schema.posts.status })
      .from(schema.posts)
      .where(and(await mine(schema.posts), eq(schema.posts.platform, platform), eq(schema.posts.fast, true), gte(schema.posts.createdAt, since)));
    if (recent.filter((r) => r.status !== "rejected").length >= f.maxPerDay) continue;
    if (recent.filter((r) => r.status === "rejected").length >= FAST_MAX_REJECTED_PER_DAY) continue;

    const at = await fastLaneTime(platform, s, now);
    const hit = await pickVerified(
      (await candidateItems(platform, s, "any", now, at)).filter(
        (it) => it.urgency === "breaking" && (it.relevance ?? 0) >= f.minRelevance && now.getTime() - it.publishedAt.getTime() <= FAST_MAX_AGE_MS,
      ),
      3,
    );
    if (!hit) continue;
    const r = await produceForSlot(platform, at, await itemMaterial(hit.it, hit.v), s, 3, { fast: true });
    if (r.status === "scheduled") out.produced++;
    else out.rejected++;
  }
  return out;
}

export interface FillResult {
  produced: number;
  rejected: number;
  idle: string | null;
}

/** "Fill now" always looks at least this many days ahead, even when autopilot plans fewer. */
export const FILL_NOW_MIN_DAYS = 5;
export const fillNowDays = (s: Pick<Settings, "horizonDays">) => Math.max(s.horizonDays, FILL_NOW_MIN_DAYS);

/** Generates up to `max` posts for the earliest empty slots in the horizon. */
export async function fillCalendar(opts: { max?: number; now?: Date; deadline?: number; retryFailedSince?: Date; horizonDays?: number } = {}): Promise<FillResult> {
  const { max = 1, now = new Date(), deadline = Infinity } = opts;
  const s = await getSettings();
  const res: FillResult = { produced: 0, rejected: 0, idle: null };
  if (s.paused) return { ...res, idle: "paused" };

  try {
    const f = await runFastLane(s, now);
    res.produced += f.produced;
    res.rejected += f.rejected;
  } catch (err) {
    if (err instanceof LLMError || err instanceof LimitError) return { ...res, idle: err.message };
    throw err;
  }

  // Slots with nothing worth posting are skipped for this pass (and retried on the next one, when new stories may have arrived).
  const skipped = new Set<string>();
  let guard = 0;
  while (res.produced + res.rejected < max && Date.now() < deadline && guard++ < max + 12) {
    const from = new Date(now.getTime() + 20 * 60_000);
    const to = new Date(now.getTime() + (opts.horizonDays ?? s.horizonDays) * 86_400_000);
    const all = slotsBetween(s, from, to);
    if (!all.length) return { ...res, idle: "no slots configured" };

    const taken = await db()
      .select({ platform: schema.posts.platform, at: schema.posts.scheduledAt, status: schema.posts.status, createdAt: schema.posts.createdAt })
      .from(schema.posts)
      .where(and(await mine(schema.posts), gte(schema.posts.scheduledAt, from), lte(schema.posts.scheduledAt, to)));
    const occupied = new Set(taken.filter((t) => (LIVE as readonly string[]).includes(t.status)).map((t) => `${t.platform}@${t.at.getTime()}`));
    const attempts = new Map<string, number>();
    // Only recent rejections count, so a slot that failed gets another try once new stories have come in.
    // "Fill now" gives every failed slot a fresh set of attempts.
    const retryAfter = opts.retryFailedSince?.getTime() ?? now.getTime() - SLOT_RETRY_AFTER_MS;
    for (const t of taken.filter((t) => t.status === "rejected" && t.createdAt.getTime() > retryAfter)) attempts.set(`${t.platform}@${t.at.getTime()}`, (attempts.get(`${t.platform}@${t.at.getTime()}`) ?? 0) + 1);
    const free = all.filter((sl) => !occupied.has(`${sl.platform}@${sl.at.getTime()}`) && !skipped.has(`${sl.platform}@${sl.at.getTime()}`) && (attempts.get(`${sl.platform}@${sl.at.getTime()}`) ?? 0) < MAX_ATTEMPTS_PER_SLOT);
    // Make room for breaking news if every free slot is too late; the freed slot is picked up on the next pass.
    let bumped = false;
    for (const p of ["x", "linkedin"] as const) {
      if (await bumpForUrgent(p, s, now, free.filter((f) => f.platform === p))) {
        bumped = true;
        break;
      }
    }
    if (bumped) continue;
    if (!free.length) return { ...res, idle: res.produced + res.rejected ? null : skipped.size ? "nothing worth posting right now" : "calendar full" };
    const target = free[0];

    let material: Material | null;
    try {
      material = await chooseMaterial(target.platform, target.at, s, now);
    } catch (err) {
      if (err instanceof LLMError || err instanceof LimitError) return { ...res, idle: err.message };
      throw err;
    }
    if (!material) {
      skipped.add(`${target.platform}@${target.at.getTime()}`);
      continue;
    }
    try {
      const out = await produceForSlot(target.platform, target.at, material, s);
      if (out.status === "scheduled") res.produced++;
      else {
        res.rejected++;
        const n = (attempts.get(`${target.platform}@${target.at.getTime()}`) ?? 0) + 1;
        if (n >= MAX_ATTEMPTS_PER_SLOT) await notifyText(`I could not write a post good enough for ${formatLocal(target.at, s.timezone)} (${target.platform}). I will try that slot again in a few hours, when new stories have come in. A note about what you worked on also helps.`).catch(() => {});
      }
      // Items that were rejected are not retried for this platform (the post row records the use).
    } catch (err) {
      if (err instanceof LLMError || err instanceof LimitError) return { ...res, idle: err.message };
      throw err;
    }
  }
  return res;
}
