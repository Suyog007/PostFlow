import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  DATABASE_URL: z.string().default("postgres://postflow@localhost:54329/postflow"),
  APP_URL: z.string().default("http://localhost:3000"),
  APP_TIMEZONE: z.string().default("Asia/Kathmandu"),
  APP_PASSWORD_HASH: optional,
  APP_USER_EMAIL: z.string().default("me@example.com"),
  SESSION_SECRET: optional,
  TOKEN_ENCRYPTION_KEY: optional,
  FIREWORKS_API_KEY: optional,
  FIREWORKS_MODEL: optional,
  FIREWORKS_RESEARCH_MODEL: optional,
  FIREWORKS_REASONING_EFFORT_ROUTINE: optional,
  FIREWORKS_REASONING_EFFORT_RESEARCH: optional,
  FIREWORKS_BASE_URL: z.string().default("https://api.fireworks.ai/inference/v1"),
  FIREWORKS_PRICE_INPUT_PER_M: optional,
  FIREWORKS_PRICE_OUTPUT_PER_M: optional,
  GITHUB_TOKEN: optional,
  LINKEDIN_CLIENT_ID: optional,
  LINKEDIN_CLIENT_SECRET: optional,
  /** LinkedIn API version header (YYYYMM). Must be a version still inside its sunset window. */
  LINKEDIN_VERSION: z.string().default("202511"),
  X_CLIENT_ID: optional,
  X_CLIENT_SECRET: optional,
  /** Optional: paid image generation (off unless a key is set). */
  BFL_API_KEY: optional,
  OPENAI_API_KEY: optional,
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
