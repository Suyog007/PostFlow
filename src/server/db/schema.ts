import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  real,
  date,
  bigserial,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Shared value types
// ---------------------------------------------------------------------------

/** Typed atoms extracted from pasted articles. Stored on `intakes.atoms`. */
export interface IntakeAtom {
  id: string;
  kind: "stat" | "quote" | "insight" | "question" | "contrarian" | "takeaway";
  text: string;
  note?: string;
}

/** Reference to a stored image. Stored on `draft_revisions.media`, bound to the revision. */
export interface MediaRef {
  mediaId: string;
  role: "image" | "slide";
  alt: string;
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const platformEnum = pgEnum("platform", ["linkedin", "x"]);

export const sourceKindEnum = pgEnum("source_kind", ["rss", "github_search"]);

export const itemStatusEnum = pgEnum("item_status", [
  "new", // collected, not analyzed yet
  "filtered", // dropped by deterministic filters
  "analyzed", // LLM analysis + score stored
  "saved",
  "dismissed",
]);

export const timelinessEnum = pgEnum("timeliness", ["breaking", "timely", "evergreen"]);

export const draftStatusEnum = pgEnum("draft_status", [
  "draft",
  "awaiting_approval",
  "approved",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "rejected",
  "cancelled",
]);

export const scheduledStateEnum = pgEnum("scheduled_state", [
  "scheduled", // waiting for its time
  "publishing", // claimed by the worker
  "published",
  "failed", // definitively failed, can be retried manually
  "cancelled",
  "needs_review", // stale or blocked; never auto-published
  "unknown", // ambiguous API result, must be reconciled before any retry
]);

export const publicationStatusEnum = pgEnum("publication_status", [
  "pending",
  "success",
  "failed",
  "ambiguous",
]);

export const claimKindEnum = pgEnum("claim_kind", ["fact", "interpretation", "prediction", "speculation"]);
export const claimVerificationEnum = pgEnum("claim_verification", [
  "multi_source",
  "primary_source",
  "single_source",
  "unverified",
  "disputed",
]);

export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "succeeded", "failed"]);

// ---------------------------------------------------------------------------
// Users & preferences
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per user. `data` is validated by the zod schema in server/preferences. */
export const preferences = pgTable("preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: sourceKindEnum("kind").notNull(),
  url: text("url").notNull(),
  /** Hint for the classifier, e.g. "ai", "nepal", "startups". */
  topicHint: text("topic_hint"),
  /** Official/primary publisher (lab, company, government). */
  isPrimary: boolean("is_primary").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  pollIntervalMinutes: integer("poll_interval_minutes").notNull().default(180),
  config: jsonb("config").notNull().default({}),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("sources_kind_url_uq").on(t.kind, t.url)]);

/** A development. Several reports (item_sources) can belong to one item. */
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull().default("article"), // article | repo
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    excerpt: text("excerpt"),
    contentHash: text("content_hash").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    status: itemStatusEnum("status").notNull().default("new"),
    filterReason: text("filter_reason"),
    prefilterScore: real("prefilter_score"),
    category: text("category"),
    timeliness: timelinessEnum("timeliness"),
    /** LLM analysis (validated). Facts and interpretation are kept apart. */
    analysis: jsonb("analysis"),
    analysisVersion: text("analysis_version"),
    score: real("score"),
    research: jsonb("research"),
    researchedAt: timestamp("researched_at", { withTimezone: true }),
    meta: jsonb("meta").notNull().default({}),
  },
  (t) => [
    index("items_status_score_idx").on(t.status, t.score),
    index("items_published_idx").on(t.publishedAt),
    index("items_first_seen_idx").on(t.firstSeenAt),
  ],
);

export const itemSources = pgTable(
  "item_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    url: text("url").notNull(),
    urlHash: text("url_hash").notNull(),
    title: text("title").notNull(),
    publisher: text("publisher"),
    excerpt: text("excerpt"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("item_sources_url_hash_uq").on(t.urlHash), index("item_sources_item_idx").on(t.itemId)],
);

export const repoSnapshots = pgTable(
  "repo_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    fullName: text("full_name").notNull(),
    stars: integer("stars").notNull(),
    forks: integer("forks").notNull(),
    openIssues: integer("open_issues").notNull().default(0),
    pushedAt: timestamp("pushed_at", { withTimezone: true }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("repo_snapshots_name_idx").on(t.fullName, t.capturedAt)],
);

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    kind: claimKindEnum("kind").notNull(),
    verification: claimVerificationEnum("verification").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("claims_item_idx").on(t.itemId)],
);

export const claimEvidence = pgTable(
  "claim_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    itemSourceId: uuid("item_source_id").references(() => itemSources.id, { onDelete: "set null" }),
    url: text("url").notNull(),
    note: text("note"),
  },
  (t) => [index("claim_evidence_claim_idx").on(t.claimId)],
);

export const scores = pgTable(
  "scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    relevance: real("relevance").notNull(),
    recency: real("recency").notNull(),
    evidence: real("evidence").notNull(),
    insight: real("insight").notNull(),
    audience: real("audience").notNull(),
    penalties: jsonb("penalties").notNull().default([]),
    weights: jsonb("weights").notNull(),
    total: real("total").notNull(),
    explanation: text("explanation").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scores_item_idx").on(t.itemId, t.createdAt)],
);

export const briefings = pgTable("briefings", {
  id: uuid("id").primaryKey().defaultRandom(),
  localDate: date("local_date").notNull(),
  jobRunId: uuid("job_run_id"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const briefingItems = pgTable(
  "briefing_items",
  {
    briefingId: uuid("briefing_id")
      .notNull()
      .references(() => briefings.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
  },
  (t) => [primaryKey({ columns: [t.briefingId, t.itemId] })],
);

// ---------------------------------------------------------------------------
// Ideas library
// ---------------------------------------------------------------------------

export const ideas = pgTable(
  "ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    links: jsonb("links").$type<string[]>().notNull().default([]),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").notNull().default("active"), // active | used | archived
    usedCount: integer("used_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ideas_user_status_idx").on(t.userId, t.status)],
);

// ---------------------------------------------------------------------------
// Intake: articles the user found (URL) or wrote (pasted text)
// ---------------------------------------------------------------------------

export const intakes = pgTable(
  "intakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("text"), // url | text
    url: text("url"),
    title: text("title").notNull().default(""),
    byline: text("byline"),
    siteName: text("site_name"),
    /** Extracted (or pasted) body text. */
    text: text("text").notNull(),
    summary: text("summary"),
    /** Typed atoms mined from the text: the units drafts are built from. */
    atoms: jsonb("atoms").$type<IntakeAtom[]>().notNull().default([]),
    status: text("status").notNull().default("ready"), // ready | archived
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("intakes_user_created_idx").on(t.userId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Media (rendered cards, carousel slides, OG images, generated art)
// ---------------------------------------------------------------------------

export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // card | slide | og | generated
    /** Relative path under the media root (.data/media). */
    filePath: text("file_path").notNull(),
    mime: text("mime").notNull().default("image/png"),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull().default(0),
    sha256: text("sha256").notNull(),
    alt: text("alt").notNull().default(""),
    meta: jsonb("meta").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("media_user_created_idx").on(t.userId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Drafts, approvals, scheduling, publishing
// ---------------------------------------------------------------------------

/** One platform-specific post. LinkedIn and X versions are separate rows. */
export const drafts = pgTable(
  "drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    ideaId: uuid("idea_id").references(() => ideas.id, { onDelete: "set null" }),
    intakeId: uuid("intake_id").references(() => intakes.id, { onDelete: "set null" }),
    status: draftStatusEnum("status").notNull().default("draft"),
    currentRevisionId: uuid("current_revision_id"),
    angle: text("angle"),
    timeliness: timelinessEnum("timeliness").notNull().default("timely"),
    /** After this moment a time-sensitive post is considered stale. */
    freshUntil: timestamp("fresh_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("drafts_user_status_idx").on(t.userId, t.status), index("drafts_item_idx").on(t.itemId)],
);

/** Immutable revisions. What gets approved and published is a revision, never "the draft". */
export const draftRevisions = pgTable(
  "draft_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    revisionNo: integer("revision_no").notNull(),
    /** For X threads: several posts. LinkedIn: exactly one. */
    parts: jsonb("parts").$type<string[]>().notNull(),
    /** Engagement format: post | thread | carousel | whatif | contrarian | takeaways | quote_take | question */
    format: text("format").notNull().default("post"),
    /** Images bound to this revision (uploaded at publish time). */
    media: jsonb("media").$type<MediaRef[]>().notNull().default([]),
    contentHash: text("content_hash").notNull(),
    author: text("author").notNull(), // "user" | "llm"
    instruction: text("instruction"),
    review: jsonb("review"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("draft_revisions_no_uq").on(t.draftId, t.revisionNo)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => draftRevisions.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    approvedBy: uuid("approved_by")
      .notNull()
      .references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
  },
  (t) => [index("approvals_revision_idx").on(t.revisionId)],
);

export const scheduledPosts = pgTable(
  "scheduled_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => draftRevisions.id),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => approvals.id),
    platform: platformEnum("platform").notNull(),
    contentHash: text("content_hash").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    state: scheduledStateEnum("state").notNull().default("scheduled"),
    idempotencyKey: text("idempotency_key").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    reviewReason: text("review_reason"),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("scheduled_posts_idem_uq").on(t.idempotencyKey),
    // At most one live schedule per draft.
    uniqueIndex("scheduled_posts_one_active_per_draft_uq")
      .on(t.draftId)
      .where(sql`state in ('scheduled','publishing','unknown','needs_review')`),
    // Never publish identical content twice on the same platform.
    uniqueIndex("scheduled_posts_no_dup_content_uq")
      .on(t.platform, t.contentHash)
      .where(sql`state in ('scheduled','publishing','unknown','published')`),
    index("scheduled_posts_due_idx").on(t.state, t.scheduledAt),
  ],
);

export const publications = pgTable(
  "publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduledPostId: uuid("scheduled_post_id")
      .notNull()
      .references(() => scheduledPosts.id, { onDelete: "cascade" }),
    attemptNo: integer("attempt_no").notNull(),
    platform: platformEnum("platform").notNull(),
    status: publicationStatusEnum("status").notNull().default("pending"),
    externalIds: jsonb("external_ids").$type<string[]>().notNull().default([]),
    externalUrl: text("external_url"),
    httpStatus: integer("http_status"),
    error: text("error"),
    /** Estimated platform cost of this attempt (USD), when known. */
    costUsd: real("cost_usd"),
    response: jsonb("response"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("publications_attempt_uq").on(t.scheduledPostId, t.attemptNo)],
);

/** Audit trail for drafts and scheduled posts. */
export const draftEvents = pgTable(
  "draft_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    actor: text("actor").notNull(), // "user" | "worker" | "system"
    details: jsonb("details").notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("draft_events_draft_idx").on(t.draftId, t.at)],
);

export const feedback = pgTable(
  "feedback",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // saved | dismissed | edited | rejected | approved | published | researched
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    draftId: uuid("draft_id").references(() => drafts.id, { onDelete: "set null" }),
    ideaId: uuid("idea_id").references(() => ideas.id, { onDelete: "set null" }),
    category: text("category"),
    details: jsonb("details").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("feedback_user_idx").on(t.userId, t.createdAt)],
);

export const metrics = pgTable("metrics", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  publicationId: uuid("publication_id")
    .notNull()
    .references(() => publications.id, { onDelete: "cascade" }),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  impressions: integer("impressions"),
  likes: integer("likes"),
  reposts: integer("reposts"),
  replies: integer("replies"),
  raw: jsonb("raw"),
});

export const platformAccounts = pgTable(
  "platform_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    externalUserId: text("external_user_id"),
    handle: text("handle"),
    displayName: text("display_name"),
    /** AES-256-GCM encrypted. */
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    scopes: text("scopes"),
    status: text("status").notNull().default("disconnected"), // connected | error | disconnected
    lastError: text("last_error"),
    paused: boolean("paused").notNull().default(false),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("platform_accounts_user_platform_uq").on(t.userId, t.platform)],
);

export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  platform: platformEnum("platform").notNull(),
  codeVerifierEnc: text("code_verifier_enc"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ---------------------------------------------------------------------------
// Jobs & LLM accounting
// ---------------------------------------------------------------------------

/** Durable job queue + history (ingestion, research runs). Publishing uses scheduled_posts directly. */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(), // discovery | publish | reconcile | staleness
    status: jobStatusEnum("status").notNull().default("queued"),
    trigger: text("trigger").notNull().default("schedule"), // schedule | manual
    payload: jsonb("payload").notNull().default({}),
    stats: jsonb("stats").notNull().default({}),
    error: text("error"),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("job_runs_kind_status_idx").on(t.kind, t.status, t.queuedAt)],
);

export const llmCalls = pgTable(
  "llm_calls",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    task: text("task").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    cacheKey: text("cache_key").notNull(),
    cached: boolean("cached").notNull().default(false),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    estCostUsd: real("est_cost_usd"),
    status: text("status").notNull(), // ok | error | budget_blocked | invalid_output
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("llm_calls_created_idx").on(t.createdAt)],
);

export const llmCache = pgTable("llm_cache", {
  cacheKey: text("cache_key").primaryKey(),
  output: jsonb("output").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
