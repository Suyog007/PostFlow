import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { removePost, restorePost } from "../src/server/posts";
import { me, resetDb } from "./helpers";

beforeEach(resetDb);

describe("putting a removed post back", () => {
  it("works when its slot is still free, and explains instead of crashing when another post took the slot", async () => {
    const at = new Date(Date.now() + 2 * 86_400_000);
    const [a] = await db().insert(schema.posts).values({ userId: me(), platform: "linkedin", pillar: "news", text: "First", status: "scheduled", scheduledAt: at }).returning();
    await removePost(a.id);
    await restorePost(a.id);
    expect((await db().select().from(schema.posts).where(eq(schema.posts.id, a.id)))[0].status).toBe("scheduled");

    await removePost(a.id);
    await db().insert(schema.posts).values({ userId: me(), platform: "linkedin", pillar: "learning", text: "Lesson in the same slot", status: "scheduled", scheduledAt: at });
    await expect(restorePost(a.id)).rejects.toThrow(/Another post has taken that slot/);
    expect((await db().select().from(schema.posts).where(eq(schema.posts.id, a.id)))[0].status).toBe("cancelled");
  });
});
