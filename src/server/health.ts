import { eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { env } from "./env";
import { isPlatformConfigured } from "./platforms/accounts";
import { llmConfigured } from "./llm";
import { telegramConfigured } from "./telegram";

export interface Check {
  label: string;
  ok: boolean;
  hint: string;
  critical?: boolean;
}

export async function recordHeartbeat() {
  await db()
    .insert(schema.settings)
    .values({ id: "heartbeat", data: { at: new Date().toISOString() } })
    .onConflictDoUpdate({ target: schema.settings.id, set: { data: { at: new Date().toISOString() }, updatedAt: new Date() } });
}

export async function lastHeartbeat(): Promise<Date | null> {
  const row = await db().query.settings.findFirst({ where: eq(schema.settings.id, "heartbeat") });
  const at = (row?.data as { at?: string } | undefined)?.at;
  return at ? new Date(at) : null;
}

export async function healthChecks(): Promise<Check[]> {
  const e = env();
  const accounts = await db().select().from(schema.platformAccounts);
  const live = (p: string) => accounts.find((a) => a.platform === p && a.status === "connected");
  const beat = await lastHeartbeat();
  const beatOk = !!beat && Date.now() - beat.getTime() < 30 * 60_000;
  return [
    { label: "AI model (Fireworks)", ok: llmConfigured(), critical: true, hint: "Set FIREWORKS_API_KEY and FIREWORKS_MODEL." },
    { label: "Scheduler is running", ok: beatOk, critical: true, hint: beat ? `Last tick was ${Math.round((Date.now() - beat.getTime()) / 60000)} min ago. Check your cron job hits /api/cron/tick every 5 minutes.` : "No tick yet. Create a cron job that calls /api/cron/tick every 5 minutes with your CRON_SECRET." },
    { label: "LinkedIn connected", ok: !!live("linkedin"), hint: isPlatformConfigured("linkedin") ? "Press Connect LinkedIn below." : "Create a LinkedIn app and set LINKEDIN_CLIENT_ID / SECRET." },
    { label: "X connected", ok: !!live("x"), hint: isPlatformConfigured("x") ? "Press Connect X below." : "Create an X app and set X_CLIENT_ID (and X_CLIENT_SECRET)." },
    { label: "Telegram alerts", ok: telegramConfigured(), hint: "Optional but recommended: set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET." },
    { label: "Token encryption key", ok: !!e.TOKEN_ENCRYPTION_KEY, critical: true, hint: "Set TOKEN_ENCRYPTION_KEY (openssl rand -base64 32)." },
    { label: "Cron secret", ok: !!e.CRON_SECRET, critical: true, hint: "Set CRON_SECRET so only your scheduler can trigger ticks." },
  ];
}
