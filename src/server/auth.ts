import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";
import { setRequestUserResolver } from "./context";
import { entitlementOf } from "./billing/plans";
import { findUser, type UserRow } from "./users";

const COOKIE = "pf_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function secret() {
  const s = env().SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters).");
  return new TextEncoder().encode(s);
}

export function authConfigured() {
  const s = env().SESSION_SECRET;
  return Boolean(s && s.length >= 32);
}

// Best-effort limiter (per server instance). Passwords are hashed with scrypt, so guessing stays slow anyway.
const attempts = new Map<string, { n: number; reset: number }>();
export async function rateLimited(scope: string, max = 8, windowMs = 15 * 60_000): Promise<boolean> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.reset < now) {
    attempts.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  return ++a.n > max;
}

export async function startSession(user: Pick<UserRow, "id" | "sessionVersion">) {
  const token = await new SignJWT({ ver: user.sessionVersion }).setSubject(user.id).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: env().APP_URL.startsWith("https://"), path: "/", maxAge: MAX_AGE });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

/** The signed-in user for this request (memoised per request), or null. */
export const getSessionUser = cache(async (): Promise<UserRow | null> => {
  if (!authConfigured()) return null;
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    const user = await findUser(payload.sub);
    // A password change or "sign out everywhere" bumps the version and ends older sessions.
    if (!user || user.sessionVersion !== payload.ver) return null;
    return user;
  } catch {
    return null;
  }
});

// Server code (settings, posts, ...) asks the context for the current user; in web requests it is the session user.
setRequestUserResolver(async () => (await getSessionUser())?.id ?? null);

export async function isLoggedIn(): Promise<boolean> {
  return !!(await getSessionUser());
}

/** Signed in (any state). Redirects to sign-in otherwise. */
export async function requireUser(): Promise<UserRow> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Signed in, email confirmed and subscribed (or owner). Every app page and action uses this. */
export async function requireActiveUser(): Promise<UserRow> {
  const user = await requireUser();
  if (!user.emailVerifiedAt) redirect("/verify-email");
  if (!entitlementOf(user).active) redirect("/billing");
  return user;
}

/** Admin only. Everyone else gets a 404, so the page's existence is not revealed. */
export async function requireOwnerUser(): Promise<UserRow> {
  const user = await requireUser();
  if (!user.isOwner || !user.emailVerifiedAt || !env().OWNER_EMAILS.includes(user.email)) notFound();
  return user;
}
