/**
 * Draft lifecycle. Pure and deterministic — every status change goes through `assertTransition`.
 * Approval is stored separately (approvals table) and is bound to one immutable revision.
 */
export type DraftStatus =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "rejected"
  | "cancelled";

const TRANSITIONS: Record<DraftStatus, DraftStatus[]> = {
  draft: ["awaiting_approval", "approved", "rejected", "cancelled"],
  awaiting_approval: ["draft", "awaiting_approval", "approved", "rejected", "cancelled"],
  approved: ["scheduled", "publishing", "awaiting_approval", "rejected", "cancelled"],
  scheduled: ["approved", "publishing", "awaiting_approval", "cancelled", "rejected"],
  publishing: ["published", "failed", "scheduled"],
  published: [],
  failed: ["scheduled", "publishing", "awaiting_approval", "cancelled", "rejected", "published"],
  rejected: ["awaiting_approval"],
  cancelled: ["awaiting_approval"],
};

export class TransitionError extends Error {
  constructor(public from: DraftStatus, public to: DraftStatus) {
    super(`A ${label(from)} post cannot move to ${label(to)}.`);
  }
}

export function canTransition(from: DraftStatus, to: DraftStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: DraftStatus, to: DraftStatus) {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
}

/** Editing content is allowed until the post is published. */
export function isEditable(status: DraftStatus) {
  return status !== "published" && status !== "publishing";
}

export function label(s: DraftStatus | string) {
  return s.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Platform validation (deterministic)
// ---------------------------------------------------------------------------

export const LIMITS = {
  x: { perPost: 280, maxParts: 15 },
  linkedin: { perPost: 3000, maxParts: 1 },
} as const;

const URL_RE = /https?:\/\/[^\s]+/g;

/**
 * Approximation of X's weighted length: URLs count as 23, most Latin/punctuation as 1,
 * other code points (CJK, emoji, Devanagari…) as 2.
 */
export function xWeightedLength(text: string): number {
  let len = 0;
  const withoutUrls = text.replace(URL_RE, () => {
    len += 23;
    return "";
  });
  for (const ch of withoutUrls) {
    const cp = ch.codePointAt(0)!;
    const light =
      (cp >= 0 && cp <= 4351) || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247);
    len += light ? 1 : 2;
  }
  return len;
}

export function postLength(platform: "x" | "linkedin", text: string) {
  return platform === "x" ? xWeightedLength(text) : [...text].length;
}

export function validateParts(platform: "x" | "linkedin", parts: string[]): string[] {
  const errors: string[] = [];
  const limits = LIMITS[platform];
  if (parts.length === 0 || parts.every((p) => p.trim() === "")) errors.push("The post is empty.");
  if (parts.length > limits.maxParts) {
    errors.push(platform === "linkedin" ? "LinkedIn posts must be a single post." : `Threads are limited to ${limits.maxParts} posts.`);
  }
  parts.forEach((p, i) => {
    if (p.trim() === "") errors.push(`Part ${i + 1} is empty.`);
    const len = postLength(platform, p);
    if (len > limits.perPost) {
      errors.push(`${parts.length > 1 ? `Part ${i + 1}` : "The post"} is ${len} characters; the ${platform === "x" ? "X" : "LinkedIn"} limit is ${limits.perPost}.`);
    }
  });
  return errors;
}

export function normalizeParts(parts: string[]): string[] {
  return parts.map((p) => p.replace(/\r\n/g, "\n").trim()).filter((p) => p.length > 0);
}

// ---------------------------------------------------------------------------
// Personal-experience guard
// ---------------------------------------------------------------------------

/**
 * Detects first-person claims of *doing* something ("In my repo…", "I tested…", "our team shipped…").
 * The subject of a news story must never be absorbed into the author's experience.
 * Returns the matched phrase, or null. Deliberately pattern-based: it only triggers a rewrite pass.
 */
const FIRST_PERSON_ACTION_RE =
  /\b(?:i|we)(?:['’]ve|['’]d| have| had)?\s+(?:built|build|tested|test|tried|try|used|use|shipped|ship|wrote|write|ran|run|deployed|deploy|switched|switch|migrated|migrate|created|create|made|make|launched|launch|benchmarked|benchmark|prototyped|prototype|implemented|implement|adopted|adopt|replaced|replace|integrated|integrate)\b|\b(?:my|our)\s+(?:repo|repository|team|company|startup|project|codebase|setup|workflow|pipeline|experiment|benchmark|prototype|stack|tooling|infra|infrastructure|app|product|model|agents?)\b/i;

export function firstPersonActionClaim(text: string): string | null {
  const m = text.match(FIRST_PERSON_ACTION_RE);
  return m ? m[0] : null;
}
