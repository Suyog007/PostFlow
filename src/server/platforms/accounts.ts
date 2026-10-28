import crypto from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env } from "../env";
import { decryptSecret, encryptSecret, randomToken } from "../crypto";
import { uid } from "../context";
import type { AccountCredentials, Platform, PlatformClient } from "./types";
import { xClient, xFetchMe, X_AUTHORIZE_URL, X_REVOKE_URL, X_SCOPES, X_TOKEN_URL } from "./x";
import { linkedinClient, linkedinFetchMe, LINKEDIN_AUTHORIZE_URL, LINKEDIN_REVOKE_URL, LINKEDIN_SCOPES, LINKEDIN_TOKEN_URL } from "./linkedin";
import { log } from "../log";

// ---------------------------------------------------------------------------
// Client registry (tests swap in fakes)
// ---------------------------------------------------------------------------

const clients: Record<Platform, PlatformClient> = { x: xClient, linkedin: linkedinClient };

export function getPlatformClient(p: Platform): PlatformClient {
  return clients[p];
}

export function setPlatformClientForTests(p: Platform, c: PlatformClient) {
  clients[p] = c;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export function isPlatformConfigured(p: Platform) {
  const e = env();
  return p === "x" ? Boolean(e.X_CLIENT_ID) : Boolean(e.LINKEDIN_CLIENT_ID && e.LINKEDIN_CLIENT_SECRET);
}

export function redirectUri(p: Platform) {
  return `${env().APP_URL.replace(/\/$/, "")}/api/oauth/${p}/callback`;
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export async function startOAuth(platform: Platform): Promise<string> {
  if (!isPlatformConfigured(platform)) throw new Error(`${platform} app credentials are not configured on the server.`);
  if (!env().TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY must be set before connecting accounts.");
  const state = randomToken(24);
  const verifier = randomToken(48);
  await db().delete(schema.oauthStates).where(lt(schema.oauthStates.expiresAt, new Date()));
  await db()
    .insert(schema.oauthStates)
    .values({ state, userId: await uid(), platform, codeVerifierEnc: encryptSecret(verifier), expiresAt: new Date(Date.now() + 10 * 60_000) });

  if (platform === "x") {
    const u = new URL(X_AUTHORIZE_URL);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", env().X_CLIENT_ID!);
    u.searchParams.set("redirect_uri", redirectUri("x"));
    u.searchParams.set("scope", X_SCOPES.join(" "));
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", crypto.createHash("sha256").update(verifier).digest("base64url"));
    u.searchParams.set("code_challenge_method", "S256");
    return u.toString();
  }
  const u = new URL(LINKEDIN_AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", env().LINKEDIN_CLIENT_ID!);
  u.searchParams.set("redirect_uri", redirectUri("linkedin"));
  u.searchParams.set("scope", LINKEDIN_SCOPES.join(" "));
  u.searchParams.set("state", state);
  return u.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

/** A form POST to the platform's OAuth server, authenticated as this app. */
function oauthPost(platform: Platform, url: string, params: Record<string, string>): Promise<Response> {
  const e = env();
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  const body = new URLSearchParams(params);
  if (platform === "x") {
    if (e.X_CLIENT_SECRET) {
      headers.Authorization = `Basic ${Buffer.from(`${e.X_CLIENT_ID}:${e.X_CLIENT_SECRET}`).toString("base64")}`;
    } else {
      body.set("client_id", e.X_CLIENT_ID!);
    }
  } else {
    body.set("client_id", e.LINKEDIN_CLIENT_ID!);
    body.set("client_secret", e.LINKEDIN_CLIENT_SECRET!);
  }
  return fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
}

async function tokenRequest(platform: Platform, params: Record<string, string>): Promise<TokenResponse> {
  const res = await oauthPost(platform, platform === "x" ? X_TOKEN_URL : LINKEDIN_TOKEN_URL, params);
  const json = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`Token exchange failed: ${json.error_description ?? json.error ?? `HTTP ${res.status}`}`);
  }
  return json;
}

/** Validates state (single use, unexpired, same user and platform) and stores encrypted tokens. */
export async function completeOAuth(platform: Platform, state: string, code: string) {
  const userId = await uid();
  const [row] = await db()
    .delete(schema.oauthStates)
    .where(and(eq(schema.oauthStates.state, state), eq(schema.oauthStates.platform, platform), eq(schema.oauthStates.userId, userId)))
    .returning();
  if (!row || row.expiresAt < new Date()) throw new Error("The authorization request expired or is invalid. Try connecting again.");

  const params: Record<string, string> = { grant_type: "authorization_code", code, redirect_uri: redirectUri(platform) };
  if (platform === "x") params.code_verifier = decryptSecret(row.codeVerifierEnc!);
  const tok = await tokenRequest(platform, params);
  const me = platform === "x" ? await xFetchMe(tok.access_token) : await linkedinFetchMe(tok.access_token);

  const values = {
    externalUserId: me.id,
    handle: me.handle,
    displayName: me.name,
    accessTokenEnc: encryptSecret(tok.access_token),
    refreshTokenEnc: tok.refresh_token ? encryptSecret(tok.refresh_token) : null,
    expiresAt: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : null,
    scopes: tok.scope ?? null,
    status: "connected",
    lastError: null,
    connectedAt: new Date(),
    updatedAt: new Date(),
  };
  await db()
    .insert(schema.platformAccounts)
    .values({ userId, platform, ...values })
    .onConflictDoUpdate({ target: [schema.platformAccounts.userId, schema.platformAccounts.platform], set: values });
}

const REVOKE_URL: Record<Platform, string> = { x: X_REVOKE_URL, linkedin: LINKEDIN_REVOKE_URL };

/**
 * Asks the platform to cancel our tokens, so a copy taken earlier stops working too.
 * Best effort: a failure is logged and never blocks disconnecting or deleting the account.
 */
async function revokeTokens(platform: Platform, acct: { accessTokenEnc: string | null; refreshTokenEnc: string | null }) {
  if (!isPlatformConfigured(platform)) return;
  const tokens: [string | null, "access_token" | "refresh_token"][] = [[acct.refreshTokenEnc, "refresh_token"], [acct.accessTokenEnc, "access_token"]];
  for (const [enc, hint] of tokens) {
    if (!enc) continue;
    try {
      const token = decryptSecret(enc);
      const res = await oauthPost(platform, REVOKE_URL[platform], platform === "x" ? { token, token_type_hint: hint } : { token });
      if (!res.ok) log.warn("token_revoke_failed", { platform, hint, status: res.status });
    } catch (err) {
      log.warn("token_revoke_failed", { platform, hint, error: (err as Error).message });
    }
  }
}

/** Forgets the tokens here first, then cancels them at the platform. */
export async function disconnectAccount(platform: Platform) {
  const userId = await uid();
  const [before] = await db()
    .select({ accessTokenEnc: schema.platformAccounts.accessTokenEnc, refreshTokenEnc: schema.platformAccounts.refreshTokenEnc })
    .from(schema.platformAccounts)
    .where(and(eq(schema.platformAccounts.userId, userId), eq(schema.platformAccounts.platform, platform)));
  await db()
    .update(schema.platformAccounts)
    .set({ status: "disconnected", accessTokenEnc: null, refreshTokenEnc: null, expiresAt: null, updatedAt: new Date() })
    .where(and(eq(schema.platformAccounts.userId, userId), eq(schema.platformAccounts.platform, platform)));
  if (before) await revokeTokens(platform, before);
}

/** Before an account is deleted: cancel every platform token it holds. */
export async function revokeAllAccounts() {
  for (const acct of await myAccounts()) await revokeTokens(acct.platform as Platform, acct);
}

export async function markAccountError(platform: Platform, message: string) {
  await db()
    .update(schema.platformAccounts)
    .set({ status: "error", lastError: message, updatedAt: new Date() })
    .where(and(eq(schema.platformAccounts.userId, await uid()), eq(schema.platformAccounts.platform, platform)));
}

export class NotConnectedError extends Error {}

/** The current user's connected accounts. */
export async function myAccounts() {
  return db().select().from(schema.platformAccounts).where(eq(schema.platformAccounts.userId, await uid()));
}

/** Returns usable credentials, refreshing the X token when it is close to expiry. */
export async function getCredentials(platform: Platform): Promise<AccountCredentials> {
  const userId = await uid();
  const acct = await db().query.platformAccounts.findFirst({
    where: and(eq(schema.platformAccounts.userId, userId), eq(schema.platformAccounts.platform, platform)),
  });
  if (!acct || !acct.accessTokenEnc || !acct.externalUserId || acct.status === "disconnected") {
    throw new NotConnectedError(`${platform === "x" ? "X" : "LinkedIn"} is not connected.`);
  }
  const expiringSoon = acct.expiresAt && acct.expiresAt.getTime() < Date.now() + 2 * 60_000;
  if (!expiringSoon) return { accessToken: decryptSecret(acct.accessTokenEnc), externalUserId: acct.externalUserId };

  if (!acct.refreshTokenEnc) {
    await markAccountError(platform, "Access token expired. Reconnect the account.");
    throw new NotConnectedError("Access token expired. Reconnect the account.");
  }
  try {
    const tok = await tokenRequest(platform, { grant_type: "refresh_token", refresh_token: decryptSecret(acct.refreshTokenEnc) });
    await db()
      .update(schema.platformAccounts)
      .set({
        accessTokenEnc: encryptSecret(tok.access_token),
        refreshTokenEnc: tok.refresh_token ? encryptSecret(tok.refresh_token) : acct.refreshTokenEnc,
        expiresAt: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : null,
        status: "connected",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.platformAccounts.userId, userId), eq(schema.platformAccounts.platform, platform)));
    return { accessToken: tok.access_token, externalUserId: acct.externalUserId };
  } catch (err) {
    const msg = `Token refresh failed: ${(err as Error).message}. Reconnect the account.`;
    await markAccountError(platform, msg);
    throw new NotConnectedError(msg);
  }
}
