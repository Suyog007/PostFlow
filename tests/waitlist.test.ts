import { beforeEach, describe, expect, it } from "vitest";
import { joinWaitlist, listWaitlist } from "../src/server/waitlist";
import { resetDb } from "./helpers";

describe("waitlist", () => {
  beforeEach(resetDb);

  it("stores a normalised email once, keeping the latest plan", async () => {
    expect((await joinWaitlist({ email: "  Maya@Example.com ", plan: "starter" })).ok).toBe(true);
    expect((await joinWaitlist({ email: "maya@example.com", plan: "pro" })).ok).toBe(true);
    const rows = await listWaitlist();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "maya@example.com", plan: "pro" });
  });

  it("keeps the earlier plan when a later sign-up has none, and ignores unknown plans", async () => {
    await joinWaitlist({ email: "a@example.com", plan: "agency" });
    await joinWaitlist({ email: "a@example.com", plan: "enterprise" });
    expect((await listWaitlist())[0].plan).toBe("agency");
  });

  it("rejects invalid emails", async () => {
    expect(await joinWaitlist({ email: "not-an-email" })).toEqual({ ok: false, error: "Enter a valid email address." });
    expect(await listWaitlist()).toHaveLength(0);
  });
});
