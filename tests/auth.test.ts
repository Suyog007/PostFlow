import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/client";
import { resetEnvCache } from "../src/server/env";
import { outbox } from "../src/server/email";
import { AuthError, checkPassword, consumeToken, createUser, LEGACY_OWNER_ID, markVerified, sendPasswordReset, sendVerificationEmail, setPassword, userFromGoogle } from "../src/server/users";
import { safeNext } from "../src/server/google";
import { resetDb } from "./helpers";

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}

const tokenFrom = (url: string) => new URL(url).searchParams.get("token")!;

describe("accounts and sign-in", () => {
  beforeEach(async () => {
    await resetDb();
    outbox.length = 0;
    setEnv({ SIGNUPS_OPEN: "true", OWNER_EMAILS: undefined });
  });
  afterEach(() => setEnv({ SIGNUPS_OPEN: undefined, OWNER_EMAILS: undefined }));

  it("sign-up, then sign in with the password", async () => {
    const u = await createUser({ email: "  New@Example.com ", password: "correct horse battery", name: "New", verified: false, timezone: "Europe/Berlin" });
    expect(u.email).toBe("new@example.com");
    expect(u.emailVerifiedAt).toBeNull();
    await expect(checkPassword("new@example.com", "correct horse battery")).resolves.toMatchObject({ id: u.id });
    await expect(checkPassword("new@example.com", "wrong password!")).rejects.toThrow("Incorrect email or password.");
    await expect(checkPassword("nobody@example.com", "whatever12345")).rejects.toThrow("Incorrect email or password.");
    await expect(createUser({ email: "new@example.com", password: "another long one", verified: false })).rejects.toThrow(/already exists/);
  });

  it("rejects short passwords and closed sign-ups (but owners can always sign up)", async () => {
    await expect(createUser({ email: "a@example.com", password: "short", verified: false })).rejects.toThrow();
    setEnv({ SIGNUPS_OPEN: "false", OWNER_EMAILS: "boss@example.com" });
    await expect(createUser({ email: "b@example.com", password: "long enough pass", verified: false })).rejects.toThrow(AuthError);
    const boss = await createUser({ email: "boss@example.com", password: "long enough pass", verified: false });
    expect(boss.isOwner).toBe(true);
  });

  it("email verification link works once", async () => {
    const u = await createUser({ email: "v@example.com", password: "long enough pass", verified: false });
    await sendVerificationEmail(u);
    expect(outbox).toHaveLength(1);
    const token = tokenFrom(outbox[0].action!.url);
    expect((await consumeToken(token, "verify"))?.id).toBe(u.id);
    expect(await consumeToken(token, "verify")).toBeNull();
    expect(await consumeToken(token, "reset")).toBeNull();
    expect((await markVerified(u.id)).emailVerifiedAt).not.toBeNull();
  });

  it("password reset: no hint for unknown emails; new password signs out other sessions", async () => {
    await sendPasswordReset("ghost@example.com");
    expect(outbox).toHaveLength(0);
    const u = await createUser({ email: "r@example.com", password: "old password 123", verified: false });
    await sendPasswordReset("r@example.com");
    const user = await consumeToken(tokenFrom(outbox[0].action!.url), "reset");
    const updated = await setPassword(user!.id, "new password 456");
    expect(updated.sessionVersion).toBe(u.sessionVersion + 1);
    expect(updated.emailVerifiedAt).not.toBeNull(); // proving the inbox verifies the email
    await expect(checkPassword("r@example.com", "new password 456")).resolves.toBeTruthy();
  });

  it("limits how many emails one account can trigger", async () => {
    const u = await createUser({ email: "spam@example.com", password: "long enough pass", verified: false });
    for (let i = 0; i < 5; i++) await sendVerificationEmail(u);
    await expect(sendVerificationEmail(u)).rejects.toThrow(/Too many emails/);
  });

  it("Google: new account, then links by Google id", async () => {
    const u = await userFromGoogle({ sub: "g-1", email: "g@example.com", emailVerified: true, name: "Gee" });
    expect(u.emailVerifiedAt).not.toBeNull();
    expect(u.passwordHash).toBeNull();
    expect((await userFromGoogle({ sub: "g-1", email: "changed@example.com", emailVerified: true, name: "Gee" })).id).toBe(u.id);
    await expect(userFromGoogle({ sub: "g-2", email: "x@example.com", emailVerified: false, name: "" })).rejects.toThrow(/not verified/);
  });

  it("Google takes over an unverified password account (someone may have registered the address first)", async () => {
    const squatter = await createUser({ email: "victim@example.com", password: "attacker password", verified: false });
    const u = await userFromGoogle({ sub: "g-victim", email: "victim@example.com", emailVerified: true, name: "Victim" });
    expect(u.id).toBe(squatter.id);
    expect(u.passwordHash).toBeNull();
    expect(u.sessionVersion).toBe(squatter.sessionVersion + 1);
    await expect(checkPassword("victim@example.com", "attacker password")).rejects.toThrow();
  });

  it("the owner claims the data from the single-user version", async () => {
    await db().insert(schema.users).values({ id: LEGACY_OWNER_ID, email: "owner@postflow.invalid", isOwner: true, emailVerifiedAt: new Date() });
    await db().insert(schema.notes).values({ userId: LEGACY_OWNER_ID, text: "An old note from the single-user days.", pillar: "own_work" });
    setEnv({ SIGNUPS_OPEN: "false", OWNER_EMAILS: "me@example.com" });
    const u = await userFromGoogle({ sub: "g-owner", email: "me@example.com", emailVerified: true, name: "Me" });
    expect(u.id).toBe(LEGACY_OWNER_ID);
    expect(u.isOwner).toBe(true);
    expect(await db().select().from(schema.notes).where(eq(schema.notes.userId, u.id))).toHaveLength(1);
  });

  it("only same-site paths are allowed after sign-in", () => {
    expect(safeNext("/billing?plan=pro")).toBe("/billing?plan=pro");
    expect(safeNext("https://evil.example")).toBe("/calendar");
    expect(safeNext("//evil.example")).toBe("/calendar");
    expect(safeNext("/\\evil.example")).toBe("/calendar");
    expect(safeNext(null)).toBe("/calendar");
  });
});
