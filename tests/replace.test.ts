import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { declinePost, replaceDeclined } from "../src/server/generate";
import { replaceForUser } from "../src/server/tick";
import { me, resetDb } from "./helpers";

async function scheduled() {
  const [p] = await db().insert(schema.posts).values({ userId: me(), platform: "linkedin", pillar: "news", text: "A post", status: "scheduled", scheduledAt: new Date(Date.now() + 86_400_000) }).returning();
  return p;
}

describe("find another story, in two steps", () => {
  beforeEach(resetDb);

  it("declining is immediate and only happens once", async () => {
    const p = await scheduled();
    await declinePost(p.id);
    expect((await db().query.posts.findFirst({ where: eq(schema.posts.id, p.id) }))?.status).toBe("declined");
    await expect(declinePost(p.id)).rejects.toThrow(/already swapped/);
  });

  it("the replacement step only works on a declined post", async () => {
    const p = await scheduled();
    await expect(replaceDeclined(p.id)).rejects.toThrow(/not found/i);
  });

  it("when no replacement can be written, the background step reports why instead of throwing", async () => {
    const p = await scheduled();
    await declinePost(p.id);
    const r = await replaceForUser(me(), p.id);
    expect(r.replacementId).toBeNull();
    expect(r.message.length).toBeGreaterThan(5);
  });
});
