import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { resetEnvCache } from "../src/server/env";
import { fillCalendar } from "../src/server/generate";
import { saveSettings } from "../src/server/settings";
import { runTask, setLLMProviderForTests, type LLMProvider } from "../src/server/llm";
import { z } from "zod";
import { fakeLLM, GOOD_REVIEW, me, resetDb } from "./helpers";

const SLOT = [{ platform: "linkedin" as const, days: [1, 2, 3, 4, 5, 6, 7], time: "09:30" }];

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}

async function addStory() {
  await db().insert(schema.items).values({ userId: me(), url: "https://example.com/acme", title: "Acme ships Postgres backups in seconds", summary: "Acme says backups now take seconds.", body: "Acme says Postgres backups now take seconds instead of an hour, for every plan.", pillar: "news", publishedAt: new Date(Date.now() - 3_600_000), relevance: 9, urgency: "evergreen", analyzedAt: new Date(), verification: { ok: true, independent: 2, needed: 2, primary: false, risky: false, mentions: [], reason: "x", checkedAt: new Date().toISOString() } });
}

describe("final check by a second model", () => {
  beforeEach(async () => {
    await resetDb();
    await saveSettings({ slots: SLOT, horizonDays: 3, pillars: { own_work: 0, news: 1, local: 0, learning: 0 } });
  });
  afterEach(() => setEnv({ FIREWORKS_FINAL_MODEL: undefined, FIREWORKS_FALLBACK_MODEL: undefined }));

  it("is skipped when no final model is set", async () => {
    await addStory();
    const calls = fakeLLM((req) => (req.schemaName === "write_post" ? { text: "Acme says Postgres backups now take seconds, not an hour." } : GOOD_REVIEW));
    await fillCalendar({ max: 1 });
    expect(calls.some((c) => c.schemaName === "final_check")).toBe(false);
    expect((await db().select().from(schema.posts))[0].status).toBe("scheduled");
  });

  it("runs on approved drafts with its own model, and can hold a post back", async () => {
    setEnv({ FIREWORKS_FINAL_MODEL: "accounts/fireworks/models/gpt-oss-120b" });
    await addStory();
    const calls = fakeLLM((req) =>
      req.schemaName === "write_post"
        ? { text: "Acme says Postgres backups now take seconds, not an hour." }
        : req.schemaName === "final_check"
          ? { ...GOOD_REVIEW, factual: 5, claims: [{ claim: "for every plan", support: "unsupported", evidence: "" }], issues: ["Overstates the change."] }
          : GOOD_REVIEW,
    );
    await fillCalendar({ max: 1 });
    const final = calls.find((c) => c.schemaName === "final_check");
    expect(final?.model).toBe("accounts/fireworks/models/gpt-oss-120b");
    expect(final?.system).toMatch(/FINAL, INDEPENDENT CHECK/);
    const [p] = await db().select().from(schema.posts).where(eq(schema.posts.userId, me()));
    expect(p.status).toBe("rejected");
    expect(p.error).toMatch(/Final check/);
    expect((p.review as { finalCheck: { approved: boolean } }).finalCheck.approved).toBe(false);
  });

  it("lets a post through when the final check agrees", async () => {
    setEnv({ FIREWORKS_FINAL_MODEL: "accounts/fireworks/models/gpt-oss-120b" });
    await addStory();
    fakeLLM((req) => (req.schemaName === "write_post" ? { text: "Acme says Postgres backups now take seconds, not an hour." } : GOOD_REVIEW));
    await fillCalendar({ max: 1 });
    const [p] = await db().select().from(schema.posts);
    expect(p.status).toBe("scheduled");
    expect((p.review as { finalCheck: { approved: boolean } }).finalCheck.approved).toBe(true);
  });
});

describe("fallback model", () => {
  afterEach(() => setEnv({ FIREWORKS_FALLBACK_MODEL: undefined }));

  it("retries a failed call once on the fallback model", async () => {
    await resetDb();
    setEnv({ FIREWORKS_FALLBACK_MODEL: "backup-model" });
    const seen: string[] = [];
    const p: LLMProvider = {
      async complete(req) {
        seen.push(req.model);
        if (req.model !== "backup-model") throw Object.assign(new Error("Fireworks rejected the request (HTTP 404): model not found"), { code: "provider" });
        return { text: JSON.stringify({ ok: true }), inputTokens: 1, outputTokens: 1 };
      },
    };
    setLLMProviderForTests(p);
    const out = await runTask({ task: "t", role: "writer", system: "s", user: "u", output: z.object({ ok: z.boolean() }), maxTokens: 10 });
    expect(out.ok).toBe(true);
    expect(seen.at(-1)).toBe("backup-model");
  });
});

describe("room to think", () => {
  afterEach(() => setEnv({ FIREWORKS_REASONING_EFFORT: undefined, FIREWORKS_FALLBACK_MODEL: undefined }));

  it("raises the output limit when the model thinks first, and falls back when it still runs out", async () => {
    await resetDb();
    setEnv({ FIREWORKS_REASONING_EFFORT: "medium", FIREWORKS_FALLBACK_MODEL: "backup-model" });
    const seen: { model: string; max: number }[] = [];
    setLLMProviderForTests({
      async complete(req) {
        seen.push({ model: req.model, max: req.maxTokens });
        return req.model === "backup-model" ? { text: JSON.stringify({ ok: true }), inputTokens: 1, outputTokens: 1 } : { text: "", inputTokens: 1, outputTokens: 1, finishReason: "length" };
      },
    });
    const out = await runTask({ task: "t", role: "reviewer", system: "s", user: "u", output: z.object({ ok: z.boolean() }), maxTokens: 400 });
    expect(out.ok).toBe(true);
    expect(seen[0].max).toBe(10400);
    // Writing thinks less ("low") once an effort is set, so it gets a smaller allowance.
    seen.length = 0;
    await runTask({ task: "t", role: "writer", system: "s", user: "u", output: z.object({ ok: z.boolean() }), maxTokens: 400 });
    expect(seen[0].max).toBe(3400);
    expect(seen.at(-1)?.model).toBe("backup-model");
  });
});

describe("autopilot leaves room for what you ask for", () => {
  it("stops filling at 70% of the daily allowance; Fill now still runs", async () => {
    await resetDb();
    await saveSettings({ slots: SLOT, horizonDays: 3, pillars: { own_work: 0, news: 1, local: 0, learning: 0 } });
    await addStory();
    // The test account is on Pro: 200 calls a day, so 140 is the autopilot's share.
    await db().insert(schema.llmCalls).values(Array.from({ length: 140 }, () => ({ userId: me(), task: "write_post", model: "m", status: "ok" })));
    const calls = fakeLLM((req) => (req.schemaName === "write_post" ? { text: "Acme says Postgres backups now take seconds, not an hour." } : GOOD_REVIEW));
    const auto = await fillCalendar({ max: 1 });
    expect(auto.idle).toMatch(/saving the rest of today's AI budget/);
    expect(calls).toHaveLength(0);
    const asked = await fillCalendar({ max: 1, retryFailedSince: new Date() });
    expect(asked.produced).toBe(1);
  });
});
