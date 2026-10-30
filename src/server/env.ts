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
  /** "true" makes PostFlow free for every confirmed account: no trial, no checkout. Turn it off to start charging. */
  FREE_BETA: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  /** Shown on the legal pages and in emails. */
  COMPANY_NAME: z.string().default("PostFlow"),
  /** A real address only: a placeholder such as "REPLACE_ME" is ignored rather than shown on the legal pages. */
  CONTACT_EMAIL: optional.transform((v) => (v && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : undefined)),
  /** The legal entity behind the service, e.g. "Jane Doe" or "Acme Pvt. Ltd., Kathmandu". Shown in the Terms. */
  LEGAL_ENTITY: optional,
  /** Governing law for the Terms, e.g. "Nepal" or "England and Wales". */
  LEGAL_JURISDICTION: optional,
  TOKEN_ENCRYPTION_KEY: optional,
  /** Bearer secret the external scheduler sends to /api/cron/tick. */
  CRON_SECRET: optional,

  FIREWORKS_API_KEY: optional,
  FIREWORKS_MODEL: optional,
  /** Optional stronger model for the reviewer. Defaults to FIREWORKS_MODEL. */
  FIREWORKS_REVIEW_MODEL: optional,
  FIREWORKS_REASONING_EFFORT: optional,
  /** Reasoning effort for writing. Defaults to "low" when FIREWORKS_REASONING_EFFORT is set (writing needs little thinking). */
  FIREWORKS_WRITER_REASONING_EFFORT: optional,
  /** A different model that gives every draft that passed review a last, independent check before it is scheduled. */
  FIREWORKS_FINAL_MODEL: optional,
  /** Reasoning effort for that final check. Defaults to "high". */
  FIREWORKS_FINAL_REASONING_EFFORT: optional,
  /** Used for a call when the configured model fails outright (missing, unsupported or returning broken JSON). */
  FIREWORKS_FALLBACK_MODEL: optional,
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

  // Visitor analytics: the token from Cloudflare > Analytics & Logs > Web Analytics (free, no cookies)
  CF_ANALYTICS_TOKEN: optional,

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
