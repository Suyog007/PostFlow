import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const PILLARS = ["own_work", "news", "nepal", "learning"] as const;
export type Pillar = (typeof PILLARS)[number];

export const POST_STATUSES = [
  "draft", // written but not on the calendar (you asked for a draft, or the reviewer held it for you)
  "scheduled", // reviewed and on the calendar; will publish unless removed
  "publishing", // claimed by the publisher right now
  "published",
  "unconfirmed", // the platform did not confirm; needs a human look
  "failed",
  "cancelled", // removed by the owner
  "expired", // time-sensitive and the window passed
  "rejected", // the reviewer refused it (kept for transparency)
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** Single-row app configuration (profile, slots, pillar weights, Telegram state). */
export const settings = pgTable("settings", {
  id: text("id").primaryKey().default("main"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const platformAccounts = pgTable("platform_accounts", {
  platform: text("platform").primaryKey(), // "x" | "linkedin"
  externalUserId: text("external_user_id"),
  handle: text("handle"),
  displayName: text("display_name"),
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  scopes: text("scopes"),
  status: text("status").notNull().default("connected"), // connected | error | disconnected
  lastError: text("last_error"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  platform: text("platform").notNull(),
  codeVerifierEnc: text("code_verifier_enc"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  url: text("url").notNull().unique(),
  pillar: text("pillar").$type<Pillar>().notNull().default("news"),
  enabled: boolean("enabled").notNull().default(true),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  lastError: text("last_error"),
});

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    body: text("body"), // full article text, fetched lazily when an item is chosen
    pillar: text("pillar").$type<Pillar>().notNull().default("news"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    // Filled by the analysis step.
    relevance: integer("relevance"), // 0-10 for this owner's profile
    urgency: text("urgency"), // "breaking" | "week" | "evergreen"
    angle: text("angle"), // one-line suggested take
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
    // Cross-check against other publishers (see verify.ts).
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verification: jsonb("verification").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("new"), // new | skipped
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("items_url_uq").on(t.url), index("items_status_idx").on(t.status, t.publishedAt)],
);

/** The owner's own material: what they built, learned or think. The only source of first-person claims. */
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  text: text("text").notNull(),
  pillar: text("pillar").$type<Pillar>().notNull().default("own_work"),
  via: text("via").notNull().default("web"), // web | telegram
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: text("platform").notNull(), // "x" | "linkedin"
    pillar: text("pillar").$type<Pillar>().notNull(),
    text: text("text").notNull(),
    status: text("status").$type<PostStatus>().notNull().default("scheduled"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    /** Time-sensitive posts are dropped, not published late, once this passes. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    noteId: uuid("note_id").references(() => notes.id, { onDelete: "set null" }),
    topic: text("topic"), // for evergreen posts, so we do not repeat ourselves
    sourceUrl: text("source_url"),
    review: jsonb("review").$type<Record<string, unknown>>(),
    userEdited: boolean("user_edited").notNull().default(false),
    /** Posted outside the normal slots because the story was too important to wait. */
    fast: boolean("fast").notNull().default(false),
    attempts: integer("attempts").notNull().default(0),
    externalId: text("external_id"),
    url: text("url"),
    error: text("error"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("posts_due_idx").on(t.status, t.scheduledAt),
    // One live post per platform slot.
    uniqueIndex("posts_slot_uq").on(t.platform, t.scheduledAt).where(sql`${t.status} in ('scheduled','publishing')`),
  ],
);

/** "Make a post from this idea or link." Processed by the scheduler (or right away after you submit). */
export const requests = pgTable("requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  input: text("input").notNull(), // an idea, a link, or a link plus your angle
  mode: text("mode").notNull().default("schedule"), // schedule (next free slot) | soon (about 20 minutes) | draft (do not schedule)
  platforms: jsonb("platforms").$type<string[]>().notNull(),
  status: text("status").notNull().default("pending"), // pending | processing | done | failed
  error: text("error"),
  postIds: jsonb("post_ids").$type<string[]>().notNull().default([]),
  via: text("via").notNull().default("web"),
  /** The link is the owner's own article: write as its author and include the link. */
  own: boolean("own").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    postId: uuid("post_id"),
  },
  (t) => [index("events_at_idx").on(t.at)],
);

export const llmCalls = pgTable("llm_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  task: text("task").notNull(),
  model: text("model"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  status: text("status").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

