import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { handleTelegramUpdate } from "../src/server/telegram-inbound";
import { getSettings } from "../src/server/settings";
import { resetDb } from "./helpers";

const msg = (text: string, chat = 42) => ({ message: { chat: { id: chat }, text } });

describe("telegram inbound", () => {
  beforeEach(resetDb);

  it("saves plain text as an own-work note and routes tags", async () => {
    await handleTelegramUpdate(msg("Shipped a Rust rewrite of our parser and it is 6x faster on large files."));
    await handleTelegramUpdate(msg("#nepal Kathmandu devs are organising a meetup about local fintech APIs next week."));
    const notes = await db().select().from(schema.notes);
    expect(notes.map((n) => n.pillar).sort()).toEqual(["nepal", "own_work"]);
    expect(notes.find((n) => n.pillar === "nepal")!.text).not.toContain("#nepal");
  });

  it("ignores everyone except the owner chat", async () => {
    await handleTelegramUpdate(msg("Shipped a Rust rewrite of our parser and it is 6x faster.", 999));
    await handleTelegramUpdate(msg("/pause", 999));
    expect(await db().select().from(schema.notes)).toHaveLength(0);
    expect((await getSettings()).paused).toBe(false);
  });

  it("/pause and /resume flip the kill switch", async () => {
    await handleTelegramUpdate(msg("/pause"));
    expect((await getSettings()).paused).toBe(true);
    await handleTelegramUpdate(msg("/resume"));
    expect((await getSettings()).paused).toBe(false);
  });

  it("the Remove button cancels a scheduled post", async () => {
    const [p] = await db().insert(schema.posts).values({ platform: "x", pillar: "own_work", text: "t", status: "scheduled", scheduledAt: new Date(Date.now() + 3_600_000) }).returning();
    await handleTelegramUpdate({ callback_query: { id: "1", data: `rm:${p.id}`, message: { chat: { id: 42 } } } });
    expect((await db().query.posts.findFirst({ where: eq(schema.posts.id, p.id) }))!.status).toBe("cancelled");
  });
});
