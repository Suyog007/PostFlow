import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";
import { verifyPassword } from "./crypto";

const COOKIE = "sd_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function secret() {
  const s = env().SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters).");
  return new TextEncoder().encode(s);
}

export function authConfigured() {
  const s = env().SESSION_SECRET;
  return Boolean(env().APP_PASSWORD_HASH && s && s.length >= 32);
}

// Best-effort limiter (per server instance). The password hash is scrypt, so guessing stays slow anyway.
const attempts = new Map<string, { n: number; reset: number }>();
function rateLimited(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.reset < now) {
    attempts.set(key, { n: 1, reset: now + 15 * 60_000 });
    return false;
  }
  return ++a.n > 8;
}

export async function login(password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!authConfigured()) return { ok: false, error: "Login is not configured. Set APP_PASSWORD_HASH and SESSION_SECRET." };
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) return { ok: false, error: "Too many attempts. Wait 15 minutes." };
  if (!verifyPassword(password, env().APP_PASSWORD_HASH!)) return { ok: false, error: "Incorrect password." };
  const token = await new SignJWT({ sub: "owner" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: env().APP_URL.startsWith("https://"), path: "/", maxAge: MAX_AGE });
  return { ok: true };
}

export async function logout() {
  (await cookies()).delete(COOKIE);
}

export async function isLoggedIn(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !authConfigured()) return false;
  try {
    await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

/** Every page, server action and route handler that touches data calls this. */
export async function requireOwner(): Promise<void> {
  if (!(await isLoggedIn())) redirect("/login");
}
