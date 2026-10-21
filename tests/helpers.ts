import { sql } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { setRequestUserResolver } from "../src/server/context";
import { setLLMProviderForTests, type CompletionRequest } from "../src/server/llm";
import { setPlatformClientForTests } from "../src/server/platforms/accounts";
import type { PlatformClient, PublishResult } from "../src/server/platforms/types";

let current: string | null = null;

/** The user the current test acts as (see resetDb). */
export function me(): string {
  if (!current) throw new Error("call resetDb() first");
  return current;
}

/** Acts as another user from now on (for isolation tests). */
export function actAs(userId: string | null) {
  current = userId;
}

/** Inserts a user. Defaults: verified, Pro plan, active subscription. */
export async function addUser(over: Partial<typeof schema.users.$inferInsert> = {}) {
  const [u] = await db()
    .insert(schema.users)
    .values({ email: `user${Math.random().toString(36).slice(2, 10)}@example.com`, name: "Test User", emailVerifiedAt: new Date(), plan: "pro", subscriptionStatus: "active", ...over })
    .returning();
  return u;
}

/** Empties the database and signs in as a fresh Pro user whose Telegram chat is 42. */
export async function resetDb() {
  await db().execute(sql`truncate users, email_tokens, posts, items, notes, sources, events, llm_calls, settings, platform_accounts, oauth_states, requests, waitlist restart identity cascade`);
  const u = await addUser({ email: "owner-of-tests@example.com", telegramChatId: "42" });
  current = u.id;
  setRequestUserResolver(async () => current);
  // The slot maths in the tests was written for this timezone (new accounts default to the browser's).
  const { saveSettings } = await import("../src/server/settings");
  await saveSettings({ timezone: "Asia/Kathmandu" });
}

export type LlmHandler = (req: CompletionRequest) => unknown;

/** Replace the model with a function that returns the JSON object for each task. */
export function fakeLLM(handler: LlmHandler) {
  const calls: CompletionRequest[] = [];
  setLLMProviderForTests({
    async complete(req) {
      calls.push(req);
      return { text: JSON.stringify(handler(req)), inputTokens: 10, outputTokens: 10 };
    },
  });
  return calls;
}

export const GOOD_REVIEW = { worth_posting: 9, factual: 9, slop: 9, claims: [{ claim: "x", support: "supported", evidence: "e" }], issues: [], revision_instructions: "", is_duplicate: false };

export function fakePlatform(platform: "x" | "linkedin", result: () => PublishResult) {
  const published: string[][] = [];
  const client: PlatformClient = {
    async publish(parts) {
      published.push(parts);
      return result();
    },
    async findRecentPost() {
      return null;
    },
  };
  setPlatformClientForTests(platform, client);
  return published;
}

export async function connectAccount(platform: "x" | "linkedin") {
  const { encryptSecret } = await import("../src/server/crypto");
  const { schema } = await import("../src/server/db/client");
  await db().insert(schema.platformAccounts).values({ userId: me(), platform, externalUserId: "u1", handle: "@me", accessTokenEnc: encryptSecret("tok"), status: "connected" }).onConflictDoNothing();
}
