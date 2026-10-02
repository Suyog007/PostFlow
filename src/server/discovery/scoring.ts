import type { Weights } from "../preferences";

export const SCORE_VERSION = "v1";

export interface FactorScores {
  relevance: number; // 0..5
  recency: number;
  evidence: number;
  insight: number;
  audience: number;
}

export interface Penalty {
  code: "repeat_topic" | "single_unverified_source" | "stale" | "muted_term" | "low_evidence";
  multiplier: number;
  note: string;
}

const clamp5 = (n: number) => Math.max(0, Math.min(5, Number.isFinite(n) ? n : 0));

/** Deterministic weighted total out of 100. */
export function totalScore(f: FactorScores, w: Weights, penalties: Penalty[] = []): number {
  const sumW = w.relevance + w.recency + w.evidence + w.insight + w.audience || 100;
  const base =
    (clamp5(f.relevance) * w.relevance +
      clamp5(f.recency) * w.recency +
      clamp5(f.evidence) * w.evidence +
      clamp5(f.insight) * w.insight +
      clamp5(f.audience) * w.audience) /
    5 /
    (sumW / 100);
  const mult = penalties.reduce((m, p) => m * p.multiplier, 1);
  return Math.round(base * mult * 10) / 10;
}

/** Recency is arithmetic, not a model opinion. Evergreen items decay slowly. */
export function recencyScore(publishedAt: Date | null, now: Date, timeliness: "breaking" | "timely" | "evergreen" | null): number {
  if (!publishedAt) return 2;
  const hours = Math.max(0, (now.getTime() - publishedAt.getTime()) / 3_600_000);
  if (timeliness === "evergreen") return hours < 24 * 14 ? 4 : hours < 24 * 60 ? 3 : 2;
  if (hours <= 12) return 5;
  if (hours <= 24) return 4.5;
  if (hours <= 48) return 3.5;
  if (hours <= 72) return 2.5;
  if (hours <= 24 * 7) return 1.5;
  return 0.5;
}

/**
 * Evidence: start from the model's judgement, then apply deterministic caps:
 * no primary source and only one report => at most 3; zero facts => at most 1.5.
 */
export function evidenceScore(modelEvidence: number, sourceCount: number, hasPrimary: boolean, factCount: number): number {
  let e = clamp5(modelEvidence);
  if (hasPrimary) e = Math.max(e, 3);
  if (!hasPrimary && sourceCount <= 1) e = Math.min(e, 3);
  if (sourceCount >= 3) e = Math.min(5, e + 0.5);
  if (factCount === 0) e = Math.min(e, 1.5);
  return e;
}

export function explainScore(f: FactorScores, total: number, penalties: Penalty[], reasons: { relevance?: string; insight?: string }) {
  const parts: string[] = [];
  const top = (Object.entries(f) as [keyof FactorScores, number][]).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const names: Record<keyof FactorScores, string> = {
    relevance: "matches your interests",
    recency: "it is recent",
    evidence: "it is well sourced",
    insight: "it opens a real opportunity or insight",
    audience: "your audience is likely to discuss it",
  };
  parts.push(`Scores ${total}/100 mainly because ${top.map(([k]) => names[k]).join(" and ")}.`);
  if (reasons.relevance) parts.push(reasons.relevance);
  if (penalties.length) parts.push(`Adjusted down: ${penalties.map((p) => p.note).join("; ")}.`);
  return parts.join(" ");
}
