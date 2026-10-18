import { env } from "./env";
import { log } from "./log";
import { formatLocal } from "./slots";

type PostRow = typeof import("./db/schema").posts.$inferSelect;

export function telegramConfigured() {
  return Boolean(env().TELEGRAM_BOT_TOKEN && env().TELEGRAM_CHAT_ID);
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

/** Plain notification to the owner. Silent no-op when Telegram is not set up. */
export async function notifyText(text: string, buttons?: { text: string; data: string }[][]) {
  const chat = env().TELEGRAM_CHAT_ID;
  if (!chat || !env().TELEGRAM_BOT_TOKEN) return;
  await sendTo(chat, text, buttons);
}

const label = (p: string) => (p === "x" ? "X" : "LinkedIn");

export async function notifyScheduled(post: PostRow, tz: string) {
  await notifyText(
    `${post.fast ? "⚡ Fast lane" : "🗓"} ${label(post.platform)} · ${formatLocal(post.scheduledAt, tz)}${post.expiresAt ? " · time-sensitive" : ""}\n\n${post.text}\n\n${post.fast ? "Big story, so it goes out soon. Remove it now if you do not want it." : "It will post automatically unless you remove it."}`,
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
