import crypto from "node:crypto";
import { env } from "./env";
import { randomToken } from "./crypto";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export function googleConfigured() {
  return Boolean(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET);
}

export function googleRedirectUri() {
  return `${env().APP_URL.replace(/\/$/, "")}/api/auth/google/callback`;
}

/** What we remember (in a short-lived httpOnly cookie) between leaving for Google and coming back. */
export interface GoogleFlow {
  state: string;
  verifier: string;
  next: string;
  timezone?: string;
}

export function startGoogleFlow(next: string, timezone?: string): { url: string; flow: GoogleFlow } {
  const flow: GoogleFlow = { state: randomToken(24), verifier: randomToken(48), next: safeNext(next), timezone: timezone?.slice(0, 64) };
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", env().GOOGLE_CLIENT_ID!);
  u.searchParams.set("redirect_uri", googleRedirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", flow.state);
  u.searchParams.set("code_challenge", crypto.createHash("sha256").update(flow.verifier).digest("base64url"));
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("prompt", "select_account");
  return { url: u.toString(), flow };
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/** Exchanges the code and reads the profile from Google (over TLS, with the fresh access token). */
export async function finishGoogleFlow(code: string, flow: GoogleFlow): Promise<GoogleProfile> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env().GOOGLE_CLIENT_ID!,
      client_secret: env().GOOGLE_CLIENT_SECRET!,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
      code_verifier: flow.verifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const tok = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  if (!res.ok || !tok.access_token) throw new Error(`Google sign-in failed: ${tok.error_description ?? tok.error ?? `HTTP ${res.status}`}`);
  const me = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(15_000) });
  const p = (await me.json().catch(() => ({}))) as { sub?: string; email?: string; email_verified?: boolean; name?: string };
  if (!me.ok || !p.sub || !p.email) throw new Error("Google did not return your email address.");
  return { sub: p.sub, email: p.email.toLowerCase(), emailVerified: p.email_verified === true, name: p.name ?? "" };
}

/** Only same-site paths are allowed as a destination after sign-in. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/calendar";
  return next.slice(0, 200);
}
