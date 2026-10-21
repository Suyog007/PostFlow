-- Multi-user: every per-user row gets a user_id. Data from the single-owner version
-- is moved to an owner account, which the owner claims by signing in with an email
-- listed in OWNER_EMAILS (see src/server/users.ts).

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"password_hash" text,
	"google_sub" text,
	"email_verified_at" timestamp with time zone,
	"is_owner" boolean DEFAULT false NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"plan" text,
	"billing_interval" text,
	"subscription_status" text,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"trial_used" boolean DEFAULT false NOT NULL,
	"telegram_chat_id" text,
	"telegram_link_code" text,
	"last_pipeline_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub"),
	CONSTRAINT "users_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "users_telegram_chat_id_unique" UNIQUE("telegram_chat_id"),
	CONSTRAINT "users_telegram_link_code_unique" UNIQUE("telegram_link_code")
);
--> statement-breakpoint
CREATE TABLE "email_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_tokens_user_idx" ON "email_tokens" USING btree ("user_id","created_at");--> statement-breakpoint

-- The existing owner, only when there is existing data to keep.
INSERT INTO "users" ("id", "email", "name", "is_owner", "email_verified_at")
SELECT '00000000-0000-4000-8000-000000000001', 'owner@postflow.invalid', 'Owner', true, now()
WHERE EXISTS (SELECT 1 FROM "settings" WHERE "id" = 'main')
   OR EXISTS (SELECT 1 FROM "posts") OR EXISTS (SELECT 1 FROM "notes")
   OR EXISTS (SELECT 1 FROM "platform_accounts") OR EXISTS (SELECT 1 FROM "sources")
   OR EXISTS (SELECT 1 FROM "items") OR EXISTS (SELECT 1 FROM "requests");--> statement-breakpoint

-- Add user_id everywhere (nullable first, backfill, then required).
ALTER TABLE "platform_accounts" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "user_id" uuid;--> statement-breakpoint

DELETE FROM "oauth_states";--> statement-breakpoint
UPDATE "platform_accounts" SET "user_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "sources" SET "user_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "items" SET "user_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "notes" SET "user_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "posts" SET "user_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "requests" SET "user_id" = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "events" SET "user_id" = '00000000-0000-4000-8000-000000000001' WHERE EXISTS (SELECT 1 FROM "users");--> statement-breakpoint
UPDATE "llm_calls" SET "user_id" = '00000000-0000-4000-8000-000000000001' WHERE EXISTS (SELECT 1 FROM "users");--> statement-breakpoint

ALTER TABLE "platform_accounts" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_states" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint

-- Keys and indexes become per user.
ALTER TABLE "platform_accounts" DROP CONSTRAINT "platform_accounts_pkey";--> statement-breakpoint
ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_user_id_platform_pk" PRIMARY KEY("user_id","platform");--> statement-breakpoint
ALTER TABLE "sources" DROP CONSTRAINT "sources_url_unique";--> statement-breakpoint
DROP INDEX "items_url_uq";--> statement-breakpoint
DROP INDEX "events_at_idx";--> statement-breakpoint
DROP INDEX "items_status_idx";--> statement-breakpoint
DROP INDEX "posts_slot_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "sources_user_url_uq" ON "sources" USING btree ("user_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "items_user_url_uq" ON "items" USING btree ("user_id","url");--> statement-breakpoint
CREATE INDEX "items_status_idx" ON "items" USING btree ("user_id","status","published_at");--> statement-breakpoint
CREATE INDEX "posts_user_idx" ON "posts" USING btree ("user_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_slot_uq" ON "posts" USING btree ("user_id","platform","scheduled_at") WHERE "posts"."status" in ('scheduled','publishing');--> statement-breakpoint
CREATE INDEX "events_at_idx" ON "events" USING btree ("user_id","at");--> statement-breakpoint

ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- The "Nepal tech scene" content type becomes "Local scene"; the owner's region is Nepal.
UPDATE "sources" SET "pillar" = 'local' WHERE "pillar" = 'nepal';--> statement-breakpoint
UPDATE "items" SET "pillar" = 'local' WHERE "pillar" = 'nepal';--> statement-breakpoint
UPDATE "notes" SET "pillar" = 'local' WHERE "pillar" = 'nepal';--> statement-breakpoint
UPDATE "posts" SET "pillar" = 'local' WHERE "pillar" = 'nepal';--> statement-breakpoint
-- Keep the owner's previous defaults (Kathmandu time, Nepal profile) where they were never saved explicitly.
UPDATE "settings" SET "data" = '{"timezone":"Asia/Kathmandu","profile":{"name":"","role":"Software engineer from Nepal","bio":"","expertise":["software engineering","AI tools for developers","building products from Nepal"],"voice":"Direct, practical and specific. Plain words. Opinionated but fair. No hype.","avoid":"Politics, religion, anything about employers, unverified claims about people or companies."}}'::jsonb || "data" WHERE "id" = 'main';--> statement-breakpoint
UPDATE "settings" SET "data" = jsonb_set("data", '{profile,region}', '"Nepal"') WHERE "id" = 'main' AND NOT ("data"->'profile' ? 'region');--> statement-breakpoint
UPDATE "settings" SET "data" = jsonb_set("data" #- '{pillars,nepal}', '{pillars,local}', "data"->'pillars'->'nepal') WHERE "data"->'pillars' ? 'nepal';--> statement-breakpoint
UPDATE "settings" SET "id" = '00000000-0000-4000-8000-000000000001' WHERE "id" = 'main';--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "id" DROP DEFAULT;
