import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  DATABASE_URL: z.string().default("postgres://postflow@localhost:54329/postflow"),
  APP_URL: z.string().default("http://localhost:3000"),
  SESSION_SECRET: optional,
  /** Comma-separated emails that are admins: never billed, see /admin. The first one also claims data from the single-user version. */
  OWNER_EMAILS: z
    .string()
    .optional()
    .transform((v) => (v ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)),
  /** "true" lets anyone create an account. Otherwise the landing page shows the waitlist and only owners can sign up. */
  SIGNUPS_OPEN: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  /** Shown on the legal pages and in emails. */
  COMPANY_NAME: z.string().default("PostFlow"),
  CONTACT_EMAIL: optional,
  TOKEN_ENCRYPTION_KEY: optional,
  /** Bearer secret the external scheduler sends to /api/cron/tick. */
  CRON_SECRET: optional,

  FIREWORKS_API_KEY: optional,
  FIREWORKS_MODEL: optional,
  /** Optional stronger model for the reviewer. Defaults to FIREWORKS_MODEL. */
  FIREWORKS_REVIEW_MODEL: optional,
  FIREWORKS_REASONING_EFFORT: optional,
  /** Reasoning effort for the reviewer. Defaults to "medium" when FIREWORKS_REASONING_EFFORT is set. */
  FIREWORKS_REVIEW_REASONING_EFFORT: optional,
  FIREWORKS_BASE_URL: z.string().default("https://api.fireworks.ai/inference/v1"),
  /** Owner accounts' model-call cap per rolling 24h (customers get their plan's cap). */
  MAX_LLM_CALLS_PER_DAY: z.coerce.number().default(150),
  /** Hard stop across all users per rolling 24h, so a bug can never run up a bill. */
  MAX_LLM_CALLS_PER_DAY_TOTAL: z.coerce.number().default(5000),

  // Sign in with Google (console.cloud.google.com > APIs & Services > Credentials)
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,

  // Email: Gmail (no domain needed) or Resend (needs a domain you own)
  /** The Gmail address that sends the emails. */
  GMAIL_USER: optional,
  /** An app password from myaccount.google.com/apppasswords (needs 2-Step Verification). */
  GMAIL_APP_PASSWORD: optional,
  /** Name shown as the sender. Defaults to COMPANY_NAME. */
  GMAIL_FROM_NAME: optional,
  RESEND_API_KEY: optional,
  /** e.g. "PostFlow <hello@yourdomain.com>" on a domain verified in Resend. */
  EMAIL_FROM: z.string().default("PostFlow <onboarding@resend.dev>"),

  // Billing (stripe.com)
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,

  LINKEDIN_CLIENT_ID: optional,
  LINKEDIN_CLIENT_SECRET: optional,
  LINKEDIN_VERSION: z.string().default("202511"),
  X_CLIENT_ID: optional,
  X_CLIENT_SECRET: optional,

  TELEGRAM_BOT_TOKEN: optional,
  /** The bot's username without @, used for the "Connect Telegram" link. */
  TELEGRAM_BOT_USERNAME: optional,
  TELEGRAM_WEBHOOK_SECRET: optional,
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Server-only configuration. Never import this from client components. */
export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

export function resetEnvCache() {
  cached = undefined;
}
