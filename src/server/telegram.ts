import { eq } from "drizzle-orm";
import { env } from "./env";
import { log } from "./log";
import { formatLocal } from "./slots";
import { db, schema } from "./db/client";
import { currentUserId, uid } from "./context";
import { randomToken } from "./crypto";

type PostRow = typeof import("./db/schema").posts.$inferSelect;

/** The PostFlow bot exists (server side). Each user links their own chat. */
export function telegramConfigured() {
  return Boolean(env().TELEGRAM_BOT_TOKEN);
}

/** The current user's linked chat id, if any. */
export async function myTelegramChat(): Promise<string | null> {
  const id = await currentUserId();
  if (!id) return null;
  const u = await db().query.users.findFirst({ where: eq(schema.users.id, id), columns: { telegramChatId: true } });
  return u?.telegramChatId ?? null;
}

/** A t.me deep link that links the current user's Telegram chat when they press Start. */
export async function telegramLinkUrl(): Promise<string | null> {
  const username = env().TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  if (!username || !env().TELEGRAM_BOT_TOKEN) return null;
  const userId = await uid();
  const u = await db().query.users.findFirst({ where: eq(schema.users.id, userId), columns: { telegramLinkCode: true } });
  let code = u?.telegramLinkCode;
  if (!code) {
    code = randomToken(18); // base64url: allowed in Telegram start payloads
    await db().update(schema.users).set({ telegramLinkCode: code, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  }
  return `https://t.me/${username}?start=${code}`;
}

export async function unlinkTelegram() {
  await db().update(schema.users).set({ telegramChatId: null, telegramLinkCode: null, updatedAt: new Date() }).where(eq(schema.users.id, await uid()));
}

async function api(method: string, body: Record<string, unknown>) {
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  }).catch((e) => {
    log.warn("telegram_error", { method, error: String(e?.message ?? e) });
    return null;
  });
  if (!res) return null;
  const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!json?.ok) log.warn("telegram_not_ok", { method, description: json?.description });
  return json;
}

export async function sendTo(chatId: string | number, text: string, buttons?: { text: string; data: string }[][]) {
  return api("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4000),
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data })) ) } } : {}),
  });
}

/** Notification to the current user's linked chat. Silent no-op when they have not linked Telegram. */
export async function notifyText(text: string, buttons?: { text: string; data: string }[][]) {
  if (!env().TELEGRAM_BOT_TOKEN) return;
  const chat = await myTelegramChat();
  if (!chat) return;
  await sendTo(chat, text, buttons);
}

const label = (p: string) => (p === "x" ? "X" : "LinkedIn");

export async function notifyScheduled(post: PostRow, tz: string, requireApproval = false) {
  const head = `${post.fast ? "⚡ Fast lane" : "🗓"} ${label(post.platform)} · ${formatLocal(post.scheduledAt, tz)}${post.expiresAt ? " · time-sensitive" : ""}\n\n${post.text}\n\n`;
  if (requireApproval) {
    await notifyText(`${head}It will not be posted until you approve it.`, [[{ text: "✅ Approve", data: `ok:${post.id}` }, { text: "🔁 Reject, find another", data: `rj:${post.id}` }]]);
    return;
  }
  await notifyText(
    `${head}${post.fast ? "Big story, so it goes out soon. Remove it now if you do not want it." : "It will post automatically unless you remove it."}`,
    [[{ text: "🗑 Remove", data: `rm:${post.id}` }]],
  );
}

export async function notifyPublished(post: PostRow) {
  await notifyText(`✅ Posted on ${label(post.platform)}${post.url ? `\n${post.url}` : ""}`);
}

export async function notifyProblem(post: PostRow, message: string) {
  await notifyText(`⚠️ ${label(post.platform)} post needs attention: ${message}\n\n${post.text.slice(0, 300)}`);
}

export async function registerWebhook(): Promise<string> {
  const e = env();
  if (!e.TELEGRAM_BOT_TOKEN) return "TELEGRAM_BOT_TOKEN is not set.";
  if (!e.TELEGRAM_WEBHOOK_SECRET) return "TELEGRAM_WEBHOOK_SECRET is not set.";
  if (!e.APP_URL.startsWith("https://")) return "Telegram needs a public https APP_URL.";
  const r = await api("setWebhook", { url: `${e.APP_URL.replace(/\/$/, "")}/api/telegram`, secret_token: e.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"] });
  return r?.ok ? "Webhook registered." : `Telegram refused: ${r?.description ?? "no response"}`;
}

export { api as telegramApi };
