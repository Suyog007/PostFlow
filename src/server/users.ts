import { and, count, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db/client";
import { env } from "./env";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { sendEmail } from "./email";
import { withUser } from "./context";
import { saveSettings } from "./settings";

export type UserRow = typeof schema.users.$inferSelect;

/** Placeholder account that holds data from the single-user version until the owner claims it. */
export const LEGACY_OWNER_ID = "00000000-0000-4000-8000-000000000001";
const LEGACY_OWNER_EMAIL = "owner@postflow.invalid";

export class AuthError extends Error {}

export const emailSchema = z.string().trim().toLowerCase().max(254).email("Enter a valid email address.");
export const passwordSchema = z.string().min(10, "Use at least 10 characters.").max(200, "That password is too long.");

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isOwnerEmail(email: string) {
  return env().OWNER_EMAILS.includes(normalizeEmail(email));
}

export function signupsOpen() {
  return env().SIGNUPS_OPEN;
}

export async function findUserByEmail(email: string) {
  return db().query.users.findFirst({ where: eq(schema.users.email, normalizeEmail(email)) });
}

export async function findUser(id: string) {
  return db().query.users.findFirst({ where: eq(schema.users.id, id) });
}

function isValidTimezone(tz: string | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates an account. When the email is an owner email and data from the single-user version is
 * waiting, the owner takes over that account (and its data) instead of getting an empty one.
 */
export async function createUser(input: { email: string; name?: string; password?: string; googleSub?: string; verified: boolean; timezone?: string; source?: string | null }): Promise<UserRow> {
  const email = emailSchema.parse(input.email);
  const owner = isOwnerEmail(email);
  if (!owner && !signupsOpen()) throw new AuthError("Sign-ups are not open yet. Join the waitlist on the home page.");
  if (await findUserByEmail(email)) throw new AuthError("An account with this email already exists. Sign in instead.");
  const name = (input.name ?? "").trim().slice(0, 80);
  const values = {
    email,
    name,
    passwordHash: input.password ? hashPassword(passwordSchema.parse(input.password)) : null,
    googleSub: input.googleSub ?? null,
    emailVerifiedAt: input.verified ? new Date() : null,
    isOwner: owner,
    signupSource: input.source ?? null,
    updatedAt: new Date(),
  };

  if (owner) {
    const legacy = await db().query.users.findFirst({ where: and(eq(schema.users.id, LEGACY_OWNER_ID), eq(schema.users.email, LEGACY_OWNER_EMAIL)) });
    if (legacy) {
      const [claimed] = await db().update(schema.users).set({ ...values, sessionVersion: legacy.sessionVersion + 1 }).where(eq(schema.users.id, LEGACY_OWNER_ID)).returning();
      return claimed;
    }
  }

  const [user] = await db().insert(schema.users).values(values).returning();
  await withUser(user.id, async () => {
    await saveSettings({
      timezone: isValidTimezone(input.timezone) ? input.timezone : "UTC",
      profile: { name, field: "tech", audience: "", role: "", bio: "", region: "", expertise: [], voice: "Direct, practical and specific. Plain words. Opinionated but fair. No hype.", avoid: "Politics, religion, anything about employers, unverified claims about people or companies." },
    });
  });
  return user;
}

let dummy: string | undefined;
const dummyHash = () => (dummy ??= hashPassword(randomToken(12)));

/** Email + password sign-in. Same message for unknown email and wrong password. */
export async function checkPassword(email: string, password: string): Promise<UserRow> {
  const user = await findUserByEmail(email);
  const fail = new AuthError("Incorrect email or password.");
  if (!user?.passwordHash) {
    // Spend about the same time either way so response timing does not reveal which emails exist.
    verifyPassword(password, dummyHash());
    throw fail;
  }
  if (!verifyPassword(password, user.passwordHash)) throw fail;
  return syncOwnerFlag(user);
}

/** OWNER_EMAILS can change between deploys; the flag follows it. */
export async function syncOwnerFlag(user: UserRow): Promise<UserRow> {
  const owner = isOwnerEmail(user.email);
  if (owner === user.isOwner) return user;
  const [u] = await db().update(schema.users).set({ isOwner: owner, updatedAt: new Date() }).where(eq(schema.users.id, user.id)).returning();
  return u;
}

/**
 * Sign in with Google. Matches by Google id, then by verified email.
 * An existing account whose email was never verified is taken over by the Google identity and its
 * password is removed: whoever set it never proved they own the address.
 */
export async function userFromGoogle(g: { sub: string; email: string; emailVerified: boolean; name: string; timezone?: string; source?: string | null }): Promise<UserRow> {
  const bySub = await db().query.users.findFirst({ where: eq(schema.users.googleSub, g.sub) });
  if (bySub) return syncOwnerFlag(bySub);
  if (!g.emailVerified) throw new AuthError("Your Google account's email is not verified.");
  const byEmail = await findUserByEmail(g.email);
  if (byEmail) {
    const patch = byEmail.emailVerifiedAt
      ? { googleSub: g.sub, updatedAt: new Date() }
      : { googleSub: g.sub, emailVerifiedAt: new Date(), passwordHash: null, sessionVersion: byEmail.sessionVersion + 1, updatedAt: new Date() };
    const [u] = await db().update(schema.users).set(patch).where(eq(schema.users.id, byEmail.id)).returning();
    return syncOwnerFlag(u);
  }
  return createUser({ email: g.email, name: g.name, googleSub: g.sub, verified: true, timezone: g.timezone, source: g.source });
}

// ---------------------------------------------------------------------------
// Email links (verify address, reset password)
// ---------------------------------------------------------------------------

type Purpose = "verify" | "reset";
const TTL_MS: Record<Purpose, number> = { verify: 48 * 3_600_000, reset: 60 * 60_000 };
const MAX_EMAILS_PER_HOUR = 5;

async function issueToken(userId: string, purpose: Purpose): Promise<string> {
  const [recent] = await db()
    .select({ n: count() })
    .from(schema.emailTokens)
    .where(and(eq(schema.emailTokens.userId, userId), gte(schema.emailTokens.createdAt, new Date(Date.now() - 3_600_000))));
  if (Number(recent.n) >= MAX_EMAILS_PER_HOUR) throw new AuthError("Too many emails requested. Try again in an hour.");
  const raw = randomToken(32);
  await db().insert(schema.emailTokens).values({ tokenHash: sha256(raw), userId, purpose, expiresAt: new Date(Date.now() + TTL_MS[purpose]) });
  return raw;
}

/** Marks the token used and returns its user, or null when it is unknown, used, expired or for another purpose. */
export async function consumeToken(raw: string, purpose: Purpose): Promise<UserRow | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(raw)) return null;
  const [row] = await db()
    .update(schema.emailTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.emailTokens.tokenHash, sha256(raw)), eq(schema.emailTokens.purpose, purpose), isNull(schema.emailTokens.usedAt), gte(schema.emailTokens.expiresAt, new Date())))
    .returning();
  return row ? ((await findUser(row.userId)) ?? null) : null;
}

/** The user a valid, unused token belongs to, without using it up (to show a confirm page). */
export async function peekTokenUser(raw: string, purpose: Purpose): Promise<UserRow | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(raw)) return null;
  const row = await db().query.emailTokens.findFirst({ where: and(eq(schema.emailTokens.tokenHash, sha256(raw)), eq(schema.emailTokens.purpose, purpose)) });
  if (!row || row.usedAt || row.expiresAt <= new Date()) return null;
  return (await findUser(row.userId)) ?? null;
}

/** Checks a reset token without using it (to show the form). */
export async function peekToken(raw: string, purpose: Purpose): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(raw)) return false;
  const row = await db().query.emailTokens.findFirst({ where: and(eq(schema.emailTokens.tokenHash, sha256(raw)), eq(schema.emailTokens.purpose, purpose)) });
  return !!row && !row.usedAt && row.expiresAt > new Date();
}

const base = () => env().APP_URL.replace(/\/$/, "");

export async function sendVerificationEmail(user: UserRow) {
  const token = await issueToken(user.id, "verify");
  await sendEmail({
    to: user.email,
    subject: `Confirm your email for ${env().COMPANY_NAME}`,
    text: `Hi${user.name ? ` ${user.name}` : ""},\n\nConfirm your email address to finish setting up your account. The link works for 48 hours.`,
    action: { label: "Confirm email", url: `${base()}/confirm-email?token=${token}` },
  });
}

/** Always succeeds from the caller's point of view, so it does not reveal which emails have accounts. */
export async function sendPasswordReset(email: string) {
  const user = await findUserByEmail(email);
  if (!user) return;
  const token = await issueToken(user.id, "reset");
  await sendEmail({
    to: user.email,
    subject: `Reset your ${env().COMPANY_NAME} password`,
    text: `Someone asked to reset the password for this account. If it was you, choose a new password below. The link works for one hour.\n\nIf it was not you, ignore this email; your password stays the same.`,
    action: { label: "Choose a new password", url: `${base()}/reset?token=${token}` },
  });
}

/**
 * Marks the email confirmed and ends every existing session, including any session started at sign-up
 * by someone who typed this address without owning it.
 * With `clearPassword`, the password set at sign-up is removed too: the person who proved the inbox did
 * not prove they chose that password, so they pick a new one (see confirm-email).
 */
export async function markVerified(userId: string, opts: { clearPassword?: boolean } = {}) {
  const user = await findUser(userId);
  if (!user) throw new AuthError("Account not found.");
  const [u] = await db()
    .update(schema.users)
    .set({
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      sessionVersion: user.sessionVersion + 1,
      ...(opts.clearPassword ? { passwordHash: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId))
    .returning();
  return syncOwnerFlag(u);
}

/** A one-hour link to choose a password, for someone who just proved they own the inbox. */
export async function issueResetToken(userId: string) {
  return issueToken(userId, "reset");
}

/** New password; every other session is signed out. Proving the inbox also verifies the email. */
export async function setPassword(userId: string, password: string): Promise<UserRow> {
  const user = await findUser(userId);
  if (!user) throw new AuthError("Account not found.");
  const [u] = await db()
    .update(schema.users)
    .set({ passwordHash: hashPassword(passwordSchema.parse(password)), sessionVersion: user.sessionVersion + 1, emailVerifiedAt: user.emailVerifiedAt ?? new Date(), updatedAt: new Date() })
    .where(eq(schema.users.id, userId))
    .returning();
  return u;
}
