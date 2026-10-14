import { desc, eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { env } from "./env";
import { sendTo, telegramApi } from "./telegram";
import { getSettings, saveSettings } from "./settings";
import { removePost, PostError, upcoming } from "./posts";
import { formatLocal } from "./slots";
import type { Pillar } from "./db/schema";

interface Update {
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
}

const HELP = `Send me any text and I save it as a note (what you built, learned or think). Tag it to steer where it goes:
#nepal  → Nepal tech scene
#learning → a lesson learned
(no tag) → your own work

/queue  upcoming posts
/pause  stop all posting
/resume start again`;

function parseNote(text: string): { pillar: Pillar; text: string } {
  const pillar: Pillar = /#nepal\b/i.test(text) ? "nepal" : /#(learning|learned|lesson)\b/i.test(text) ? "learning" : "own_work";
  return { pillar, text: text.replace(/#(nepal|learning|learned|lesson)\b/gi, "").trim() };
}

/** Handles one Telegram update. Only the configured owner chat is ever obeyed. */
export async function handleTelegramUpdate(u: Update): Promise<void> {
  const owner = env().TELEGRAM_CHAT_ID;
  const chat = u.message?.chat.id ?? u.callback_query?.message?.chat.id;
  if (!chat) return;

  if (!owner || String(chat) !== owner) {
    // Strangers learn nothing except, for /start, their own chat id (to put in the config).
    if (u.message?.text?.startsWith("/start") && !owner) await sendTo(chat, `Your chat id is ${chat}. Set TELEGRAM_CHAT_ID to it, then redeploy.`);
    return;
  }

  if (u.callback_query) {
    const data = u.callback_query.data ?? "";
    let answer = "Done";
    if (data.startsWith("rm:")) {
      try {
        await removePost(data.slice(3));
        answer = "Removed. It will not be posted.";
      } catch (err) {
        answer = err instanceof PostError ? err.message : "Could not remove it.";
      }
    }
    await telegramApi("answerCallbackQuery", { callback_query_id: u.callback_query.id, text: answer });
    await sendTo(chat, answer === "Removed. It will not be posted." ? "🗑 Removed. It will not be posted." : answer);
    return;
  }

  const text = u.message?.text?.trim();
  if (!text) return;
  const s = await getSettings();

  if (text === "/start" || text === "/help") return void (await sendTo(chat, HELP));
  if (text === "/pause") {
    await saveSettings({ paused: true });
    return void (await sendTo(chat, "⏸ Paused. Nothing will be generated or posted until /resume."));
  }
  if (text === "/resume") {
    await saveSettings({ paused: false });
    return void (await sendTo(chat, "▶️ Resumed."));
  }
  if (text === "/queue") {
    const q = await upcoming(10);
    if (!q.length) return void (await sendTo(chat, "Nothing scheduled yet."));
    return void (await sendTo(chat, q.map((p) => `${p.platform === "x" ? "X" : "LinkedIn"} · ${formatLocal(p.scheduledAt, s.timezone)}\n${p.text.slice(0, 120).replace(/\n/g, " ")}`).join("\n\n"), q.slice(0, 5).map((p) => [{ text: `🗑 Remove ${p.platform === "x" ? "X" : "LI"} ${formatLocal(p.scheduledAt, s.timezone)}`, data: `rm:${p.id}` }])));
  }
  if (text.startsWith("/")) return void (await sendTo(chat, HELP));

  const note = parseNote(text);
  if (note.text.length < 15) return void (await sendTo(chat, "That is too short to build a post from. Add a little more detail."));
  const [row] = await db().insert(schema.notes).values({ text: note.text.slice(0, 4000), pillar: note.pillar, via: "telegram" }).returning();
  const pending = await db().select({ id: schema.notes.id }).from(schema.notes).where(eq(schema.notes.pillar, note.pillar)).orderBy(desc(schema.notes.createdAt)).limit(50);
  await sendTo(chat, `📝 Saved (${note.pillar.replace("_", " ")}). I will turn it into a post for an upcoming slot. ${pending.length} note(s) in this category.`);
  void row;
}
