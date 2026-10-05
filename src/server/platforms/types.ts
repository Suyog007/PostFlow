export type Platform = "linkedin" | "x";

export interface AccountCredentials {
  accessToken: string;
  externalUserId: string;
}

export type PublishResult =
  /** The platform confirmed creation. */
  | { kind: "success"; externalIds: string[]; url?: string; httpStatus?: number; response?: unknown; costUsd?: number }
  /** The platform definitively rejected the request; nothing was created. */
  | { kind: "failed"; retryable: boolean; error: string; httpStatus?: number; retryAfterSeconds?: number; authError?: boolean; partialIds?: string[] }
  /** We cannot tell whether the post was created (timeout, 5xx, dropped connection). */
  | { kind: "ambiguous"; error: string; httpStatus?: number; partialIds?: string[] };

/** An image ready for upload at publish time (loaded from the media store by the publisher). */
export interface PublishMedia {
  data: Buffer;
  mime: string;
  alt: string;
}

export interface PublishOptions {
  media?: PublishMedia[];
  /** X only: move URLs out of the post text into a final reply (cheaper + better reach). */
  linkInReply?: boolean;
}

export interface FoundPost {
  externalId: string;
  url?: string;
}

export interface PlatformClient {
  publish(parts: string[], creds: AccountCredentials, opts?: PublishOptions): Promise<PublishResult>;
  /**
   * Look for a post with this text created after `since`. Returns null when not found;
   * throws NotSupported when the platform offers no way to check.
   */
  findRecentPost(text: string, since: Date, creds: AccountCredentials): Promise<FoundPost | null>;
}

export class ReconcileNotSupported extends Error {
  constructor(platform: Platform) {
    super(`Automatic confirmation is not available for ${platform}.`);
  }
}

/** Distinguish "never reached the server" (safe to retry) from "request may have been processed". */
export function classifyNetworkError(err: unknown): { safeToRetry: boolean; message: string } {
  const e = err as { name?: string; code?: string; cause?: { code?: string }; message?: string };
  const code = e?.cause?.code ?? e?.code ?? "";
  const preSend = ["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "CERT_HAS_EXPIRED"];
  if (preSend.includes(code)) return { safeToRetry: true, message: `Could not reach the platform (${code}).` };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return { safeToRetry: false, message: "The request timed out after it was sent." };
  return { safeToRetry: false, message: `Connection error after sending: ${e?.message ?? String(err)}` };
}
