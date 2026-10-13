import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  DATABASE_URL: z.string().default("postgres://postflow@localhost:54329/postflow"),
  APP_URL: z.string().default("http://localhost:3000"),
  APP_PASSWORD_HASH: optional,
  SESSION_SECRET: optional,
  TOKEN_ENCRYPTION_KEY: optional,
  /** Bearer secret the external scheduler sends to /api/cron/tick. */
  CRON_SECRET: optional,

  FIREWORKS_API_KEY: optional,
  FIREWORKS_MODEL: optional,
  /** Optional stronger model for the reviewer. Defaults to FIREWORKS_MODEL. */
  FIREWORKS_REVIEW_MODEL: optional,
  FIREWORKS_REASONING_EFFORT: optional,
  FIREWORKS_BASE_URL: z.string().default("https://api.fireworks.ai/inference/v1"),
  /** Hard stop on model calls per rolling 24h, so a bug can never run up a bill. */
  MAX_LLM_CALLS_PER_DAY: z.coerce.number().default(150),

  LINKEDIN_CLIENT_ID: optional,
  LINKEDIN_CLIENT_SECRET: optional,
  LINKEDIN_VERSION: z.string().default("202511"),
  X_CLIENT_ID: optional,
  X_CLIENT_SECRET: optional,

  TELEGRAM_BOT_TOKEN: optional,
  /** Only messages from this chat are accepted. Send /start to the bot to learn yours. */
  TELEGRAM_CHAT_ID: optional,
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
