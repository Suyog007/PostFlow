import { sql } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { setLLMProviderForTests, type CompletionRequest } from "../src/server/llm";
import { setPlatformClientForTests } from "../src/server/platforms/accounts";
import type { PlatformClient, PublishResult } from "../src/server/platforms/types";

export async function resetDb() {
  await db().execute(sql`truncate posts, items, notes, sources, events, llm_calls, settings, platform_accounts, oauth_states restart identity cascade`);
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
  await db().insert(schema.platformAccounts).values({ platform, externalUserId: "u1", handle: "@me", accessTokenEnc: encryptSecret("tok"), status: "connected" }).onConflictDoNothing();
}
