import { sql } from "drizzle-orm";
import { boolean, customType, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** "local" is the tech scene of the place the user names in their profile (for example "Nepal" or "Berlin"). */
export const PILLARS = ["own_work", "news", "local", "learning"] as const;
export type Pillar = (typeof PILLARS)[number];

export const POST_STATUSES = [
  "draft", // written but not on the calendar (you asked for a draft, or the reviewer held it for you)
  "scheduled", // reviewed and on the calendar; will publish unless removed
  "publishing", // claimed by the publisher right now
  "published",
  "unconfirmed", // the platform did not confirm; needs a human look
  "failed",
  "cancelled", // removed by the owner
  "declined", // rejected by the owner; its slot is refilled with a different story
  "expired", // time-sensitive and the window passed
  "rejected", // the reviewer refused it (kept for transparency)
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** One account per customer. The owner (admin) is marked with isOwner and never billed. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(), // stored lower-case
  name: text("name").notNull().default(""),
  passwordHash: text("password_hash"), // null when the user only signs in with Google
  googleSub: text("google_sub").unique(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  isOwner: boolean("is_owner").notNull().default(false),
  /** Bumped on password change or "sign out everywhere"; older sessions stop working. */
  sessionVersion: integer("session_version").notNull().default(1),
  // Billing (mirrors Stripe; the webhook keeps it in sync)
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  plan: text("plan"), // starter | pro
  billingInterval: text("billing_interval"), // month | year
  subscriptionStatus: text("subscription_status"), // trialing | active | past_due | canceled | unpaid | incomplete ...
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  trialUsed: boolean("trial_used").notNull().default(false),
  // Telegram
  telegramChatId: text("telegram_chat_id").unique(),
  telegramLinkCode: text("telegram_link_code").unique(),
  /** When the scheduler last ran the writing pipeline for this user (fair round-robin). */
  lastPipelineAt: timestamp("last_pipeline_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Single-use links sent by email (verify address, reset password). Only the hash is stored. */
export const emailTokens = pgTable(
  "email_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(), // verify | reset
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_tokens_user_idx").on(t.userId, t.createdAt)],
);

const owner = () => uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" });

/** Per-user configuration (profile, slots, content mix). The id is the user id; "heartbeat" is a global row. */
export const settings = pgTable("settings", {
  id: text("id").primaryKey(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const platformAccounts = pgTable("platform_accounts", {
  userId: owner(),
  platform: text("platform").notNull(), // "x" | "linkedin"
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
}, (t) => [primaryKey({ columns: [t.userId, t.platform] })]);

export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  userId: owner(),
  platform: text("platform").notNull(),
  codeVerifierEnc: text("code_verifier_enc"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: owner(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  pillar: text("pillar").$type<Pillar>().notNull().default("news"),
  enabled: boolean("enabled").notNull().default(true),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  lastError: text("last_error"),
}, (t) => [uniqueIndex("sources_user_url_uq").on(t.userId, t.url)]);

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
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
    kind: text("kind"), // "must_know" | "opportunity" | "other"
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
    // Cross-check against other publishers (see verify.ts).
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verification: jsonb("verification").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("new"), // new | skipped
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("items_user_url_uq").on(t.userId, t.url), index("items_status_idx").on(t.userId, t.status, t.publishedAt)],
);

/** The owner's own material: what they built, learned or think. The only source of first-person claims. */
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: owner(),
  text: text("text").notNull(),
  pillar: text("pillar").$type<Pillar>().notNull().default("own_work"),
  via: text("via").notNull().default("web"), // web | telegram
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    platform: text("platform").notNull(), // "x" | "linkedin"
    pillar: text("pillar").$type<Pillar>().notNull(),
    text: text("text").notNull(),
    status: text("status").$type<PostStatus>().notNull().default("scheduled"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    /** The calendar slot this post was planned for, kept when it is posted early so nothing else fills that slot. */
    slotAt: timestamp("slot_at", { withTimezone: true }),
    /** When the heads-up message before posting was sent (so it is sent once). */
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
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
    /** Set when the owner approves the post. While approval is required, unapproved posts are never published. */
    approvedAt: timestamp("approved_at", { withTimezone: true }),
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
    index("posts_user_idx").on(t.userId, t.scheduledAt),
    // One live post per platform slot, per user.
    uniqueIndex("posts_slot_uq").on(t.userId, t.platform, t.scheduledAt).where(sql`${t.status} in ('scheduled','publishing')`),
  ],
);

/** "Make a post from this idea or link." Processed by the scheduler (or right away after you submit). */
export const requests = pgTable("requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: owner(),
  input: text("input").notNull(), // an idea, a link, or a link plus your angle
  mode: text("mode").notNull().default("schedule"), // schedule (next free slot) | soon (about 20 minutes) | draft (do not schedule)
  platforms: jsonb("platforms").$type<string[]>().notNull(),
  status: text("status").notNull().default("pending"), // pending | processing | done | failed
  error: text("error"),
  postIds: jsonb("post_ids").$type<string[]>().notNull().default([]),
  via: text("via").notNull().default("web"),
  /** The link is the owner's own article: write as its author and include the link. */
  own: boolean("own").notNull().default(false),
  /** Text that names news the owner heard about: look it up before writing. Links are always researched. */
  research: boolean("research").notNull().default(false),
  /** Write it even if the research says it is weak. */
  force: boolean("force").notNull().default(false),
  /** What the research concluded, shown to the owner with the result. */
  summary: text("summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }), // null = system event
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    postId: uuid("post_id"),
  },
  (t) => [index("events_at_idx").on(t.userId, t.at)],
);

export const llmCalls = pgTable("llm_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }), // kept for cost accounting
  task: text("task").notNull(),
  model: text("model"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  status: text("status").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});


/** Early-access sign-ups from the public landing page. */
export const waitlist = pgTable("waitlist", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  plan: text("plan"), // starter | pro | agency (what they were looking at)
  role: text("role"), // optional: what they do
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** The picture made for a post: drawn by an image model from a scene the writer model describes. One per post. */
export const postImages = pgTable("post_images", {
  postId: uuid("post_id")
    .primaryKey()
    .references(() => posts.id, { onDelete: "cascade" }),
  userId: owner(),
  data: bytea("data").notNull(),
  mime: text("mime").notNull(),
  /** What the image model was asked to draw. */
  prompt: text("prompt").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
