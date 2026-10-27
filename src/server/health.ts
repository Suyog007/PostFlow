import { eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { env } from "./env";
import { isPlatformConfigured } from "./platforms/accounts";
import { llmConfigured } from "./llm";
import { myTelegramChat, telegramConfigured } from "./telegram";
import { uid } from "./context";

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

/** What a customer sees: their own setup. No server configuration details. */
export async function myChecks(): Promise<Check[]> {
  const userId = await uid();
  const accounts = await db().select().from(schema.platformAccounts).where(eq(schema.platformAccounts.userId, userId));
  const live = (p: string) => accounts.find((a) => a.platform === p && a.status === "connected");
  const beat = await lastHeartbeat();
  const beatOk = !!beat && Date.now() - beat.getTime() < 30 * 60_000;
  const chat = await myTelegramChat();
  return [
    { label: "LinkedIn connected", ok: !!live("linkedin"), hint: "Press Connect next to LinkedIn below." },
    { label: "X connected", ok: !!live("x"), hint: "Press Connect next to X below." },
    { label: "Telegram linked", ok: !!chat, hint: telegramConfigured() ? "Optional: approve posts and send notes from your phone." : "Telegram is not available yet." },
    { label: "Autopilot running", ok: beatOk, hint: "The scheduler has not checked in recently. We are looking into it." },
  ];
}

/** What the admin sees: server configuration. */
export async function systemChecks(): Promise<Check[]> {
  const e = env();
  const beat = await lastHeartbeat();
  const beatOk = !!beat && Date.now() - beat.getTime() < 30 * 60_000;
  return [
    { label: "AI model (Fireworks)", ok: llmConfigured(), critical: true, hint: "Set FIREWORKS_API_KEY and FIREWORKS_MODEL." },
    { label: "Scheduler is running", ok: beatOk, critical: true, hint: beat ? `Last tick was ${Math.round((Date.now() - beat.getTime()) / 60000)} min ago. Check the Netlify scheduled function (or your cron job).` : "No tick yet. Deploy to Netlify (scheduled function) or call /api/cron/tick every 5 minutes with CRON_SECRET." },
    { label: "Session secret", ok: !!e.SESSION_SECRET && e.SESSION_SECRET.length >= 32, critical: true, hint: "Set SESSION_SECRET (openssl rand -base64 48)." },
    { label: "Token encryption key", ok: !!e.TOKEN_ENCRYPTION_KEY, critical: true, hint: "Set TOKEN_ENCRYPTION_KEY (openssl rand -base64 32)." },
    { label: "Cron secret", ok: !!e.CRON_SECRET, critical: true, hint: "Set CRON_SECRET so only your scheduler can trigger ticks." },
    { label: e.GMAIL_USER && e.GMAIL_APP_PASSWORD ? "Email (Gmail)" : "Email (Gmail or Resend)", ok: !!(e.GMAIL_USER && e.GMAIL_APP_PASSWORD) || !!e.RESEND_API_KEY, critical: true, hint: "Set GMAIL_USER and GMAIL_APP_PASSWORD (no domain needed), or RESEND_API_KEY and EMAIL_FROM on a domain you own. Without one, verification and reset emails are only logged." },
    e.FREE_BETA
      ? { label: "Payments: off (free beta)", ok: true, hint: "FREE_BETA is on, so nobody is charged. Remove it once a payment provider is set up." }
      : { label: "Payments (Stripe)", ok: !!e.STRIPE_SECRET_KEY && !!e.STRIPE_WEBHOOK_SECRET, critical: true, hint: "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, then run npm run stripe:setup." },
    { label: "Google sign-in", ok: !!e.GOOGLE_CLIENT_ID && !!e.GOOGLE_CLIENT_SECRET, hint: "Optional: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." },
    { label: "LinkedIn app", ok: isPlatformConfigured("linkedin"), hint: "Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET." },
    { label: "X app", ok: isPlatformConfigured("x"), hint: "Set X_CLIENT_ID (and X_CLIENT_SECRET)." },
    { label: "Telegram bot", ok: telegramConfigured() && !!e.TELEGRAM_BOT_USERNAME && !!e.TELEGRAM_WEBHOOK_SECRET, hint: "Set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET, then register the webhook below." },
    { label: "Sign-ups open", ok: e.SIGNUPS_OPEN, hint: "SIGNUPS_OPEN is not \"true\": the landing page shows the waitlist and only owners can create accounts." },
  ];
}
