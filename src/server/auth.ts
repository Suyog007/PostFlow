import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";
import { verifyPassword } from "./crypto";
import { ensureOwner } from "./users";

const COOKIE = "sd_session";
const MAX_AGE = 60 * 60 * 24 * 14;

function secret() {
  const s = env().SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters).");
  return new TextEncoder().encode(s);
}

export function authConfigured() {
  const s = env().SESSION_SECRET;
  return Boolean(env().APP_PASSWORD_HASH && s && s.length >= 32);
}

// Simple in-process limiter for the login endpoint (single-instance app).
const attempts = new Map<string, { n: number; reset: number }>();
function rateLimited(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.reset < now) {
    attempts.set(key, { n: 1, reset: now + 15 * 60_000 });
    return false;
  }
  a.n++;
  return a.n > 8;
}

export async function login(password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!authConfigured()) return { ok: false, error: "Login is not configured. Set APP_PASSWORD_HASH and SESSION_SECRET in .env." };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) return { ok: false, error: "Too many attempts. Wait 15 minutes." };
  if (!verifyPassword(password, env().APP_PASSWORD_HASH!)) return { ok: false, error: "Incorrect password." };
  const user = await ensureOwner();
  const token = await new SignJWT({ sub: user.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax", // lax so the OAuth redirect back from LinkedIn/X keeps the session
    secure: env().APP_URL.startsWith("https://"),
    path: "/",
    maxAge: MAX_AGE,
  });
  return { ok: true };
}

export async function logout() {
  (await cookies()).delete(COOKIE);
}

export async function currentUserId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !authConfigured()) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Every page, server action, and route handler that touches data calls this. */
export async function requireUser(): Promise<string> {
  const id = await currentUserId();
  if (!id) redirect("/login");
  return id;
}
