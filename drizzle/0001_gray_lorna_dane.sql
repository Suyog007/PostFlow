CREATE TABLE "intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"url" text,
	"title" text DEFAULT '' NOT NULL,
	"byline" text,
	"site_name" text,
	"text" text NOT NULL,
	"summary" text,
	"atoms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_path" text NOT NULL,
	"mime" text DEFAULT 'image/png' NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"sha256" text NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draft_revisions" ADD COLUMN "format" text DEFAULT 'post' NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_revisions" ADD COLUMN "media" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "intake_id" uuid;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "cost_usd" real;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intakes_user_created_idx" ON "intakes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "media_user_created_idx" ON "media" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_intake_id_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."intakes"("id") ON DELETE set null ON UPDATE no action;