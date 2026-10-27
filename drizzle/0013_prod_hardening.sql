CREATE TABLE "leases" (
	"name" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "llm_calls_at_idx" ON "llm_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_user_at_idx" ON "llm_calls" USING btree ("user_id","created_at");