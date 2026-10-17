import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, sql } from "drizzle-orm";
import { db, schema } from "./db/client";
import type { Pillar } from "./db/schema";
import { runTask, untrusted, LLMError } from "./llm";
import { getSettings, type Settings } from "./settings";
import { REVIEWER_SYSTEM, profileBlock, writerSystem } from "./prompts";
import { runChecks, type Check } from "./checks";
import { slotsBetween, formatLocal } from "./slots";
import { fetchArticleText } from "./net";
import { addEvent } from "./events";
import { notifyScheduled, notifyText } from "./telegram";

type Platform = "x" | "linkedin";
const LIVE = ["scheduled", "publishing", "published", "unconfirmed", "failed", "cancelled", "expired"] as const;
const MAX_ATTEMPTS_PER_SLOT = 3;

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
}

// ---------------------------------------------------------------------------
// Material selection
// ---------------------------------------------------------------------------

const URGENCY_WINDOW_MS = { breaking: 48 * 3_600_000, week: 7 * 86_400_000 } as const;

async function usedIds(platform: Platform) {
  const rows = await db()
    .select({ itemId: schema.posts.itemId, noteId: schema.posts.noteId })
    .from(schema.posts)
    .where(eq(schema.posts.platform, platform));
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

async function itemMaterial(it: ItemRow): Promise<Material> {
  let body = it.body;
  if (!body) {
    body = await fetchArticleText(it.url);
    if (body) await db().update(schema.items).set({ body }).where(eq(schema.items.id, it.id));
  }
  const src = it.sourceId ? await db().query.sources.findFirst({ where: eq(schema.sources.id, it.sourceId) }) : null;
  const text = [`Source: ${src?.name ?? new URL(it.url).hostname}`, `Title: ${it.title}`, `Published: ${it.publishedAt.toISOString().slice(0, 10)}`, `Summary: ${it.summary}`, body ? `Article text:\n${body}` : "(Only the headline and summary are available; do not claim details beyond them.)", it.angle ? `Suggested angle (from an assistant, not a fact): ${it.angle}` : ""]
    .filter(Boolean)
    .join("\n");
  return { kind: "news", pillar: it.pillar, source: text, label: it.title, itemId: it.id, sourceUrl: it.url, expiresAt: itemExpiry(it), firstPerson: false };
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
        eq(schema.items.status, "new"),
        isNotNull(schema.items.analyzedAt),
        gte(schema.items.relevance, s.minRelevance),
        gte(schema.items.publishedAt, new Date(now.getTime() - 7 * 86_400_000)),
        pillar === "any" ? undefined : eq(schema.items.pillar, pillar),
      ),
    )
    .orderBy(desc(schema.items.relevance), desc(schema.items.publishedAt))
    .limit(60);
  // Time-sensitive items must still be fresh an hour after the slot they would take.
  return rows.filter((r) => !used.items.has(r.id) && !((e) => e && e.getTime() <= slotAt.getTime() + 3_600_000)(itemExpiry(r)));
}

async function pickNote(platform: Platform, pillar: Pillar) {
  const used = await usedIds(platform);
  const rows = await db().select().from(schema.notes).where(eq(schema.notes.pillar, pillar)).orderBy(asc(schema.notes.createdAt)).limit(40);
  return rows.find((n) => !used.notes.has(n.id));
}

const topicOut = z.object({ topic: z.string(), angle: z.string() });

async function pickEvergreenTopic(s: Settings, platform: Platform): Promise<Material> {
  const recent = await db()
    .select({ topic: schema.posts.topic, text: schema.posts.text })
    .from(schema.posts)
    .where(and(eq(schema.posts.platform, platform), eq(schema.posts.pillar, "learning")))
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
    return n ? noteMaterial(n) : pickEvergreenTopic(s, platform);
  }
  if (pillar === "news" || pillar === "nepal") {
    const items = await candidateItems(platform, s, pillar, now, slotAt);
    if (items.length) return itemMaterial(items[0]);
    if (pillar === "nepal") {
      const n = await pickNote(platform, "nepal");
      return n ? noteMaterial(n) : null;
    }
  }
  return null;
}

/** Pillars ordered by how far they are below their target share over the recent window. */
async function pillarOrder(s: Settings, now: Date): Promise<Pillar[]> {
  const rows = await db()
    .select({ pillar: schema.posts.pillar, n: sql<number>`count(*)` })
    .from(schema.posts)
    .where(and(gte(schema.posts.scheduledAt, new Date(now.getTime() - 14 * 86_400_000)), notInArray(schema.posts.status, ["rejected", "cancelled"])))
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
        eq(schema.posts.platform, platform),
        isNotNull(schema.posts.expiresAt),
        notInArray(schema.posts.status, ["rejected", "cancelled", "expired"]),
        gte(schema.posts.scheduledAt, new Date(at.getTime() - 12 * 3_600_000)),
        lte(schema.posts.scheduledAt, new Date(at.getTime() + 12 * 3_600_000)),
      ),
    );
  return Number(rows[0].n) >= MAX_URGENT_PER_DAY;
}

/** Time-sensitive items first (soonest to go stale), otherwise rotate pillars. */
export async function chooseMaterial(platform: Platform, slotAt: Date, s: Settings, now = new Date()): Promise<Material | null> {
  const capped = await urgentCapReached(platform, slotAt);
  const urgent = (capped ? [] : await candidateItems(platform, s, "any", now, slotAt))
    .map((it) => ({ it, exp: itemExpiry(it) }))
    .filter((x): x is { it: ItemRow; exp: Date } => !!x.exp && x.exp.getTime() > slotAt.getTime() + 3_600_000)
    .sort((a, b) => a.exp.getTime() - b.exp.getTime());
  if (urgent.length) return itemMaterial(urgent[0].it);
  for (const p of await pillarOrder(s, now)) {
    const m = await pickByPillar(platform, p, s, now, slotAt);
    if (m) return m;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Writer and reviewer
// ---------------------------------------------------------------------------

const writerOut = z.object({ text: z.string() });

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

async function write(m: Material, platform: Platform, s: Settings, feedback?: { previous: string; notes: string[] }): Promise<string> {
  const user = [
    describeMaterial(m),
    feedback ? `\nYour previous draft:\n"""${feedback.previous}"""\nAn editor rejected it for these reasons. Fix every one, keep what worked, do not add new facts:\n${feedback.notes.map((n) => `- ${n}`).join("\n")}` : "\nWrite the post.",
  ].join("\n");
  const res = await runTask({ task: "write_post", role: "writer", system: writerSystem(s, platform), user, output: writerOut, maxTokens: 900, temperature: 0.7 });
  return sanitize(res.text);
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

async function review(m: Material, text: string, platform: Platform, recent: string[]): Promise<Review> {
  const user = [
    `Platform: ${platform === "x" ? "X" : "LinkedIn"}`,
    describeMaterial(m),
    `DRAFT:\n"""${text}"""`,
    `RECENT POSTS (for duplicate detection):\n${recent.slice(0, 10).map((r) => `- ${r.replace(/\s+/g, " ").slice(0, 200)}`).join("\n") || "(none)"}`,
  ].join("\n\n");
  return runTask({ task: "review_post", role: "reviewer", system: REVIEWER_SYSTEM, user, output: reviewOut, maxTokens: 1500, temperature: 0.1 });
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
    .where(and(eq(schema.posts.platform, platform), inArray(schema.posts.status, ["scheduled", "published", "publishing", "unconfirmed"])))
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
  status: "scheduled" | "rejected";
  postId: string;
  reasons: string[];
}

export async function produceForSlot(platform: Platform, at: Date, m: Material, s: Settings, maxRounds = 3): Promise<Produced> {
  const recent = await recentTexts(platform);
  let text = await write(m, platform, s);
  let verdict: Verdict = { approved: false, reasons: [] };
  let lastReview: Review | null = null;
  let checks: Check[] = [];
  const rounds: { text: string; reasons: string[] }[] = [];

  for (let round = 0; round < maxRounds; round++) {
    checks = runChecks(text, platform, recent);
    lastReview = await review(m, text, platform, recent);
    verdict = gate(lastReview, checks, m);
    rounds.push({ text, reasons: verdict.reasons });
    if (verdict.approved || round === maxRounds - 1) break;
    text = await write(m, platform, s, { previous: text, notes: [...verdict.reasons, lastReview.revision_instructions].filter(Boolean) });
  }

  const finalText = verdict.approved ? withLink(text, m, platform, s) : text;
  const reviewJson = { ...lastReview, checks, verdict, rounds: rounds.length, material: { kind: m.kind, label: m.label }, reviewedAt: new Date().toISOString() } as Record<string, unknown>;
  const [row] = await db()
    .insert(schema.posts)
    .values({
      platform,
      pillar: m.pillar,
      text: finalText,
      status: verdict.approved ? "scheduled" : "rejected",
      scheduledAt: at,
      expiresAt: m.expiresAt ?? null,
      itemId: m.itemId ?? null,
      noteId: m.noteId ?? null,
      topic: m.topic ?? null,
      sourceUrl: m.sourceUrl ?? null,
      review: reviewJson,
      error: verdict.approved ? null : verdict.reasons.join(" | ").slice(0, 500),
    })
    .returning();

  if (verdict.approved) {
    await addEvent("scheduled", `${platform === "x" ? "X" : "LinkedIn"} post scheduled for ${formatLocal(at, s.timezone)}: ${m.label.slice(0, 80)}`, row.id);
    await notifyScheduled(row, s.timezone).catch(() => {});
  } else {
    await addEvent("rejected", `Reviewer rejected a ${platform} draft (${m.label.slice(0, 60)}): ${verdict.reasons[0] ?? ""}`, row.id);
  }
  return { status: verdict.approved ? "scheduled" : "rejected", postId: row.id, reasons: verdict.reasons };
}

// ---------------------------------------------------------------------------
// Keeping the calendar filled
// ---------------------------------------------------------------------------

/** Frees the earliest soft slot for a time-sensitive item that would otherwise go stale before any free slot. */
async function bumpForUrgent(platform: Platform, s: Settings, now: Date, freeSlots: { at: Date }[]): Promise<boolean> {
  const urgent = (await candidateItems(platform, s, "any", now))
    .map((it) => itemExpiry(it))
    .filter((e): e is Date => !!e && e.getTime() > now.getTime() + 3_600_000)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  if (!urgent) return false;
  const firstFree = freeSlots[0]?.at.getTime() ?? Infinity;
  if (firstFree < urgent.getTime() - 3_600_000) return false; // a free slot already works

  const victim = await db()
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.platform, platform), eq(schema.posts.status, "scheduled"), eq(schema.posts.userEdited, false), isNull(schema.posts.expiresAt), gte(schema.posts.scheduledAt, new Date(now.getTime() + 30 * 60_000)), lte(schema.posts.scheduledAt, new Date(urgent.getTime() - 3_600_000))))
    .orderBy(asc(schema.posts.scheduledAt))
    .limit(1);
  if (!victim[0]) return false;
  if (await urgentCapReached(platform, victim[0].scheduledAt)) return false;
  await db().delete(schema.posts).where(eq(schema.posts.id, victim[0].id));
  await addEvent("bumped", `Replaced an evergreen ${platform} post with a time-sensitive one.`);
  return true;
}

export interface FillResult {
  produced: number;
  rejected: number;
  idle: string | null;
}

/** Generates up to `max` posts for the earliest empty slots in the horizon. */
export async function fillCalendar(opts: { max?: number; now?: Date; deadline?: number } = {}): Promise<FillResult> {
  const { max = 1, now = new Date(), deadline = Infinity } = opts;
  const s = await getSettings();
  const res: FillResult = { produced: 0, rejected: 0, idle: null };
  if (s.paused) return { ...res, idle: "paused" };

  let guard = 0;
  while (res.produced + res.rejected < max && Date.now() < deadline && guard++ < 6) {
    const from = new Date(now.getTime() + 20 * 60_000);
    const to = new Date(now.getTime() + s.horizonDays * 86_400_000);
    const all = slotsBetween(s, from, to);
    if (!all.length) return { ...res, idle: "no slots configured" };

    const taken = await db()
      .select({ platform: schema.posts.platform, at: schema.posts.scheduledAt, status: schema.posts.status })
      .from(schema.posts)
      .where(and(gte(schema.posts.scheduledAt, from), lte(schema.posts.scheduledAt, to)));
    const occupied = new Set(taken.filter((t) => (LIVE as readonly string[]).includes(t.status)).map((t) => `${t.platform}@${t.at.getTime()}`));
    const attempts = new Map<string, number>();
    for (const t of taken.filter((t) => t.status === "rejected")) attempts.set(`${t.platform}@${t.at.getTime()}`, (attempts.get(`${t.platform}@${t.at.getTime()}`) ?? 0) + 1);
    const free = all.filter((sl) => !occupied.has(`${sl.platform}@${sl.at.getTime()}`) && (attempts.get(`${sl.platform}@${sl.at.getTime()}`) ?? 0) < MAX_ATTEMPTS_PER_SLOT);
    // Make room for breaking news if every free slot is too late; the freed slot is picked up on the next pass.
    let bumped = false;
    for (const p of ["x", "linkedin"] as const) {
      if (await bumpForUrgent(p, s, now, free.filter((f) => f.platform === p))) {
        bumped = true;
        break;
      }
    }
    if (bumped) continue;
    if (!free.length) return { ...res, idle: res.produced + res.rejected ? null : "calendar full" };
    const target = free[0];

    let material: Material | null;
    try {
      material = await chooseMaterial(target.platform, target.at, s, now);
    } catch (err) {
      if (err instanceof LLMError) return { ...res, idle: err.message };
      throw err;
    }
    if (!material) {
      // Nothing left to say for this slot: mark it as attempted so we move on to the next one.
      await db().insert(schema.posts).values({ platform: target.platform, pillar: "learning", text: "", status: "rejected", scheduledAt: target.at, error: "No material available" });
      continue;
    }
    try {
      const out = await produceForSlot(target.platform, target.at, material, s);
      if (out.status === "scheduled") res.produced++;
      else {
        res.rejected++;
        const n = (attempts.get(`${target.platform}@${target.at.getTime()}`) ?? 0) + 1;
        if (n >= MAX_ATTEMPTS_PER_SLOT) await notifyText(`I could not write a post good enough for ${formatLocal(target.at, s.timezone)} (${target.platform}). That slot stays empty. Send me a note about what you worked on and I will use it.`).catch(() => {});
      }
      // Items that were rejected are not retried for this platform (the post row records the use).
    } catch (err) {
      if (err instanceof LLMError) return { ...res, idle: err.message };
      throw err;
    }
  }
  return res;
}
