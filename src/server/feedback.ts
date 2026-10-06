import { eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { getUserPreferences, saveUserPreferences } from "./preferences";

type Action = "saved" | "dismissed" | "researched" | "approved" | "published" | "rejected" | "edited";

const INTEREST_DELTA: Partial<Record<Action, number>> = { saved: 0.04, researched: 0.03, dismissed: -0.03, approved: 0.04, published: 0.05, rejected: -0.03 };

/**
 * Records a decision and nudges the matching interest weight, so preferences evolve visibly
 * (the user can see and edit every weight in Settings). Never a hard filter.
 */
export async function recordItemFeedback(userId: string, action: Action, itemId: string) {
  const item = await db().query.items.findFirst({ where: eq(schema.items.id, itemId) });
  await db().insert(schema.feedback).values({ userId, action, itemId, category: item?.category ?? null });
  const delta = INTEREST_DELTA[action];
  const category = item?.category?.trim();
  if (!delta || !category) return;
  const prefs = await getUserPreferences(userId);
  if (prefs.learnFromFeedback === false) return;
  await nudge(userId, category, delta);
}

/**
 * Approval-feedback ranking: approving/rejecting/publishing a draft is a stronger signal than
 * reading a briefing item, so it nudges the weight of the item's category. Called after the
 * draft transaction succeeds; failures here must never break the user's action.
 */
export async function nudgeItemInterest(userId: string, itemId: string | null, delta: number) {
  if (!itemId) return;
  try {
    const prefs = await getUserPreferences(userId);
    if (prefs.learnFromFeedback === false) return;
    const item = await db().query.items.findFirst({ where: eq(schema.items.id, itemId) });
    const category = item?.category?.trim();
    if (!category) return;
    await nudge(userId, category, delta);
  } catch {
    // best-effort
  }
}

async function nudge(userId: string, category: string, delta: number) {
  const prefs = await getUserPreferences(userId);
  const key = Object.keys(prefs.interests).find((k) => k.toLowerCase() === category.toLowerCase());
  if (!key && delta < 0) return; // do not add topics just to push them down
  const current = key ? prefs.interests[key] : 0.4;
  const next = Math.round(Math.max(0, Math.min(1, current + delta)) * 100) / 100;
  await saveUserPreferences(userId, { ...prefs, interests: { ...prefs.interests, [key ?? category]: next } });
}
