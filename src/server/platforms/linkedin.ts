import { env } from "../env";
import type { AccountCredentials, FoundPost, PlatformClient, PublishMedia, PublishOptions, PublishResult } from "./types";
import { ReconcileNotSupported, classifyNetworkError } from "./types";

export const LINKEDIN_AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
export const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
/**
 * "Sign In with LinkedIn using OpenID Connect" (openid, profile) gives the member id;
 * "Share on LinkedIn" grants w_member_social for posting. Both are self-serve products.
 */
export const LINKEDIN_SCOPES = ["openid", "profile", "w_member_social"];

function headers(creds: AccountCredentials, json = true): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.accessToken}`,
    "LinkedIn-Version": env().LINKEDIN_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

/**
 * Uploads one image with the Images API and returns its urn.
 * Flow: POST /rest/images?action=initializeUpload → PUT bytes to uploadUrl.
 */
async function uploadImage(media: PublishMedia, creds: AccountCredentials): Promise<string> {
  const initRes = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST",
    headers: headers(creds),
    body: JSON.stringify({ initializeUploadRequest: { owner: `urn:li:person:${creds.externalUserId}` } }),
    signal: AbortSignal.timeout(20_000),
  });
  const initJson = (await initRes.json().catch(() => null)) as { value?: { uploadUrl?: string; image?: string }; message?: string } | null;
  if (!initRes.ok || !initJson?.value?.uploadUrl || !initJson.value.image) {
    throw new Error(`LinkedIn image upload init failed (HTTP ${initRes.status}): ${initJson?.message ?? "unknown"}`);
  }
  const putRes = await fetch(initJson.value.uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": media.mime || "image/png" },
    body: new Uint8Array(media.data),
    signal: AbortSignal.timeout(60_000),
  });
  if (!putRes.ok) throw new Error(`LinkedIn image upload failed (HTTP ${putRes.status}).`);
  return initJson.value.image;
}

export const linkedinClient: PlatformClient = {
  async publish(parts: string[], creds: AccountCredentials, opts: PublishOptions = {}): Promise<PublishResult> {
    const text = parts.join("\n\n");
    const media = (opts.media ?? []).slice(0, 20);

    // With images, use the versioned /rest/posts API (multiImage is its supported shape).
    if (media.length > 0) {
      let urns: string[];
      try {
        urns = [];
        for (const m of media) urns.push(await uploadImage(m, creds));
      } catch (err) {
        // Nothing was posted; safe to retry after fixing the cause.
        return { kind: "failed", retryable: true, error: (err as Error).message };
      }
      const content =
        media.length === 1
          ? { media: { id: urns[0], altText: media[0].alt.slice(0, 400) } }
          : { multiImage: { images: urns.map((id, i) => ({ id, altText: media[i].alt.slice(0, 400) })) } };
      const body = {
        author: `urn:li:person:${creds.externalUserId}`,
        commentary: text,
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
        content,
      };
      let res: Response;
      try {
        res = await fetch("https://api.linkedin.com/rest/posts", {
          method: "POST",
          headers: headers(creds),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        const c = classifyNetworkError(err);
        return c.safeToRetry ? { kind: "failed", retryable: true, error: c.message } : { kind: "ambiguous", error: c.message };
      }
      if (res.status === 201) {
        const id = res.headers.get("x-restli-id") ?? res.headers.get("X-RestLi-Id");
        if (!id) return { kind: "ambiguous", error: "LinkedIn returned 201 without a post id.", httpStatus: 201 };
        return { kind: "success", externalIds: [id], url: `https://www.linkedin.com/feed/update/${id}/`, httpStatus: 201 };
      }
      const text_ = await res.text().catch(() => "");
      let message = `HTTP ${res.status}`;
      try {
        message = (JSON.parse(text_) as { message?: string }).message ?? message;
      } catch {}
      if (res.status >= 500) return { kind: "ambiguous", error: `LinkedIn server error: ${message}`, httpStatus: res.status };
      return {
        kind: "failed",
        retryable: res.status === 429,
        error: `LinkedIn rejected the post: ${message}`,
        httpStatus: res.status,
        authError: res.status === 401,
      };
    }

    // Text-only: keep the classic ugcPosts shape that has served this app well.
    const body = {
      author: `urn:li:person:${creds.externalUserId}`,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };
    let res: Response;
    try {
      res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      const c = classifyNetworkError(err);
      return c.safeToRetry ? { kind: "failed", retryable: true, error: c.message } : { kind: "ambiguous", error: c.message };
    }
    if (res.status === 201) {
      const id = res.headers.get("x-restli-id") ?? res.headers.get("X-RestLi-Id");
      if (!id) return { kind: "ambiguous", error: "LinkedIn returned 201 without a post id.", httpStatus: 201 };
      return { kind: "success", externalIds: [id], url: `https://www.linkedin.com/feed/update/${id}/`, httpStatus: 201 };
    }
    const text2 = await res.text().catch(() => "");
    let message = `HTTP ${res.status}`;
    try {
      message = (JSON.parse(text2) as { message?: string }).message ?? message;
    } catch {}
    if (res.status >= 500) return { kind: "ambiguous", error: `LinkedIn server error: ${message}`, httpStatus: res.status };
    return {
      kind: "failed",
      retryable: res.status === 429,
      error: `LinkedIn rejected the post: ${message}`,
      httpStatus: res.status,
      authError: res.status === 401,
    };
  },

  async findRecentPost(): Promise<FoundPost | null> {
    // Reading a member's own posts needs restricted permissions, so we ask the user to check.
    throw new ReconcileNotSupported("linkedin");
  },
};

export async function linkedinFetchMe(accessToken: string) {
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Could not read LinkedIn profile: HTTP ${res.status}`);
  const json = (await res.json()) as { sub: string; name?: string; email?: string };
  return { id: json.sub, handle: json.name ?? json.sub, name: json.name ?? "" };
}
