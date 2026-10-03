import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { env } from "./env";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

/** ISO weekday numbers: 1 = Monday … 7 = Sunday. */
export const windowSchema = z.object({
  days: z.array(z.number().int().min(1).max(7)).min(1),
  start: time,
  end: time,
});
export type PostingWindow = z.infer<typeof windowSchema>;

export const platformRulesSchema = z.object({
  paused: z.boolean().default(false),
  maxPerDay: z.number().int().min(0).max(50),
  maxPerWeek: z.number().int().min(0).max(200),
  minIntervalMinutes: z.number().int().min(0).max(60 * 24 * 7),
  windows: z.array(windowSchema).min(1),
  /** X: approved evergreen posts may be suggested for quiet periods. */
  allowEvergreenFill: z.boolean().default(false),
  /** Prefer timely posts first when suggesting slots. */
  prioritizeTimely: z.boolean().default(true),
  /** X: move URLs out of the post text into a final reply (cheaper, better reach). */
  linkInReply: z.boolean().default(true),
  /** Free-text guidance for the drafting model (tone, length). */
  styleNotes: z.string().max(1000).default(""),
});
export type PlatformRules = z.infer<typeof platformRulesSchema>;

export const weightsSchema = z
  .object({
    relevance: z.number().min(0).max(100),
    recency: z.number().min(0).max(100),
    evidence: z.number().min(0).max(100),
    insight: z.number().min(0).max(100),
    audience: z.number().min(0).max(100),
  })
  .refine((w) => Math.abs(w.relevance + w.recency + w.evidence + w.insight + w.audience - 100) < 0.01, {
    message: "Weights must add up to 100",
  });
export type Weights = z.infer<typeof weightsSchema>;

export const preferencesSchema = z.object({
  timezone: z.string().default("Asia/Kathmandu"),
  /** Topic -> weight 0..1. Grows from feedback; never a hard filter. */
  interests: z.record(z.string(), z.number().min(0).max(1)),
  /** Terms that should push an item out of the briefing. */
  mutedTerms: z.array(z.string()).default([]),
  aboutMe: z.string().max(2000).default(""),
  /** Editable voice rules, injected into every drafting prompt. */
  voiceRules: z.string().max(2000).default(""),
  /** Calibrate drafts with recent approved posts as few-shot examples. */
  voiceExemplars: z.boolean().default(true),
  /** Let approvals/rejections nudge interest weights (visible in Settings). */
  learnFromFeedback: z.boolean().default(true),
  weights: weightsSchema,
  briefing: z.object({
    maxItems: z.number().int().min(1).max(20),
    minScore: z.number().min(0).max(100),
    maxPerCategory: z.number().int().min(1).max(10),
    staleNewsDays: z.number().int().min(1).max(30),
    repeatWindowDays: z.number().int().min(1).max(60),
  }),
  llm: z.object({
    enabled: z.boolean(),
    dailyBudgetUsd: z.number().min(0).max(1000),
    dailyTokenLimit: z.number().int().min(0),
    maxItemsAnalyzedPerRun: z.number().int().min(1).max(200),
    batchSize: z.number().int().min(1).max(20),
  }),
  discovery: z.object({
    autoRunTimes: z.array(time).default(["06:30"]),
  }),
  /** Draft the best ideas automatically after each discovery run, so they wait as ready posts. */
  autoDraft: z.object({
    enabled: z.boolean(),
    perRun: z.number().int().min(0).max(10),
  }),
  /** Images attached to drafts automatically. */
  images: z.object({
    /** Render a card (stat/quote/list/headline) when the model judges one clearly worth it. */
    autoCard: z.boolean().default(true),
  }),
  /** What "Approve" does: schedule at the platform's next open slot, or publish immediately. */
  approval: z.object({
    mode: z.enum(["next_slot", "now"]),
  }),
  platforms: z.object({ linkedin: platformRulesSchema, x: platformRulesSchema }),
});
export type Preferences = z.infer<typeof preferencesSchema>;

export function defaultPreferences(): Preferences {
  return {
    timezone: env().APP_TIMEZONE,
    // AI-only desk: keep the interest graph focused; other topics are still read, just ranked lower.
    interests: {
      "AI models and agents": 0.9,
      "AI research": 0.8,
      "open-source AI tools": 0.8,
      "new business opportunities": 0.8,
      "AI in practice and workflows": 0.7,
      "AI policy and safety": 0.6,
      "startups and funding": 0.6,
      "grants and hackathons": 0.6,
      "developer ecosystems": 0.6,
      "economics and strategy": 0.4,
    },
    mutedTerms: ["celebrity", "sports score", "horoscope"],
    aboutMe: "",
    voiceRules: "",
    voiceExemplars: true,
    learnFromFeedback: true,
    weights: { relevance: 25, recency: 20, evidence: 20, insight: 20, audience: 15 },
    briefing: { maxItems: 8, minScore: 45, maxPerCategory: 3, staleNewsDays: 4, repeatWindowDays: 10 },
    llm: { enabled: true, dailyBudgetUsd: 1, dailyTokenLimit: 400_000, maxItemsAnalyzedPerRun: 40, batchSize: 8 },
    discovery: { autoRunTimes: ["06:30"] },
    autoDraft: { enabled: true, perRun: 5 },
    images: { autoCard: true },
    approval: { mode: "next_slot" },
    platforms: {
      linkedin: {
        paused: false,
        maxPerDay: 1,
        maxPerWeek: 3,
        minIntervalMinutes: 60 * 24,
        windows: [{ days: [2, 3, 4], start: "09:00", end: "11:00" }],
        allowEvergreenFill: false,
        prioritizeTimely: true,
        linkInReply: false,
        styleNotes: "",
      },
      x: {
        paused: false,
        maxPerDay: 4,
        maxPerWeek: 20,
        minIntervalMinutes: 120,
        windows: [
          { days: [1, 2, 3, 4, 5], start: "08:00", end: "11:00" },
          { days: [1, 2, 3, 4, 5], start: "18:00", end: "22:00" },
          { days: [6, 7], start: "10:00", end: "20:00" },
        ],
        allowEvergreenFill: true,
        prioritizeTimely: true,
        linkInReply: true,
        styleNotes: "",
      },
    },
  };
}

export async function getUserPreferences(userId: string): Promise<Preferences> {
  const row = await db().query.preferences.findFirst({ where: eq(schema.preferences.userId, userId) });
  if (!row) return defaultPreferences();
  // Merge over defaults so new settings appear without a data migration.
  const merged = deepMerge(defaultPreferences(), row.data as Partial<Preferences>);
  const parsed = preferencesSchema.safeParse(merged);
  return parsed.success ? parsed.data : defaultPreferences();
}

export async function saveUserPreferences(userId: string, prefs: Preferences): Promise<Preferences> {
  const data = preferencesSchema.parse(prefs);
  await db()
    .insert(schema.preferences)
    .values({ userId, data, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.preferences.userId, set: { data, updatedAt: new Date() } });
  return data;
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (Array.isArray(base) || typeof base !== "object" || base === null) {
    return (patch === undefined ? base : patch) as T;
  }
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    const b = (base as Record<string, unknown>)[k];
    // interests is a free-form record: replace rather than merge so removals stick.
    out[k] = k === "interests" ? v : b === undefined ? v : deepMerge(b, v);
  }
  return out as T;
}
