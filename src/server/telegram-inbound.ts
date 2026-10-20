import { desc, eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { env } from "./env";
import { sendTo, telegramApi } from "./telegram";
import { getSettings, saveSettings } from "./settings";
import { removePost, PostError, upcoming } from "./posts";
import { formatLocal } from "./slots";
import type { Pillar } from "./db/schema";
import { after } from "next/server";
import { createRequest, processRequests, type RequestMode } from "./requests";
import { addTip } from "./tips";

interface Update {
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
}

const HELP = `Make a post from something:
/post <idea or link>   write it for LinkedIn and X, next free slots
/now <idea or link>    same, but about 20 minutes from now
/draft <idea or link>  write it, do not schedule
/mine <link>           a link to your own article: written as you, with the link in the post

Other ways to feed me:
- Any plain text is saved as a note (what you built, learned or think). Tags: #nepal, #learning
- A plain link is a story tip: I cross-check it against other publishers and post it only if it holds up

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
  const cmd = text.match(/^\/(post|now|draft|mine)(?:@\w+)?\s*([\s\S]*)$/i);
  if (cmd) {
    const mode: RequestMode = cmd[1] === "now" ? "soon" : cmd[1] === "draft" ? "draft" : "schedule";
    try {
      const req = await createRequest({ text: cmd[2], mode, via: "telegram", own: cmd[1].toLowerCase() === "mine" });
      await sendTo(chat, `✍️ On it. I will write it for ${req.platforms.length > 1 ? "LinkedIn and X" : "your platform"}${mode === "draft" ? " as drafts" : ""}. Expect it here in a minute or two.`);
      try {
        after(() => processRequests({ max: 1 }).then(() => undefined));
      } catch {
        // outside a request (tests): the scheduler picks it up
      }
    } catch (err) {
      await sendTo(chat, (err as Error).message);
    }
    return;
  }
  if (text.startsWith("/")) return void (await sendTo(chat, HELP));
  if (/^https?:\/\/\S+$/i.test(text)) {
    const tip = await addTip(text);
    return void (await sendTo(chat, `${tip.ok ? "🔎" : "⚠️"} ${tip.message}`));
  }

  const note = parseNote(text);
  if (note.text.length < 15) return void (await sendTo(chat, "That is too short to build a post from. Add a little more detail."));
  const [row] = await db().insert(schema.notes).values({ text: note.text.slice(0, 4000), pillar: note.pillar, via: "telegram" }).returning();
  const pending = await db().select({ id: schema.notes.id }).from(schema.notes).where(eq(schema.notes.pillar, note.pillar)).orderBy(desc(schema.notes.createdAt)).limit(50);
  await sendTo(chat, `📝 Saved (${note.pillar.replace("_", " ")}). I will turn it into a post for an upcoming slot. ${pending.length} note(s) in this category.`);
  void row;
}
