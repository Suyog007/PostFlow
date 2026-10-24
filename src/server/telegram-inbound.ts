import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { uid, withUser } from "./context";
import { approvalGate, entitlementFor, entitlementOf } from "./billing/plans";
import { DateTime } from "luxon";
import { sendTo, telegramApi } from "./telegram";
import { getSettings, saveSettings } from "./settings";
import { approvePost, postNow, removePost, PostError, upcoming } from "./posts";
import { publishDue } from "./publisher";
import { rejectAndReplace, rewordPost } from "./generate";
import { requestFillNow } from "./tick";
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
- Any plain text is saved as a note (what you built, learned or think). Tags: #local, #learning
- A plain link is a story tip: I cross-check it against other publishers and post it only if it holds up

/fill   write posts now for every open slot in the next 5 days
/queue  upcoming posts by day, in full. Each has Approve, Post now, Remove, Another story and New wording buttons
/pause  stop all posting
/resume start again
/unlink disconnect this chat from PostFlow`;

const QUICK_REWORD = "Take a different angle and a fresh opening. Keep the same story and the same facts.";

/** Buttons under a post you may want to act on. */
function postButtons(id: string) {
  return [
    [{ text: "✅ Approve", data: `ok:${id}` }, { text: "🗑 Remove", data: `rm:${id}` }],
    [{ text: "🔁 Another story", data: `rj:${id}` }, { text: "✍️ New wording", data: `rw:${id}` }],
  ];
}

function parseNote(text: string): { pillar: Pillar; text: string } {
  // #nepal is kept as an alias of #local for accounts from the single-user version.
  const pillar: Pillar = /#(local|nepal)\b/i.test(text) ? "local" : /#(learning|learned|lesson)\b/i.test(text) ? "learning" : "own_work";
  return { pillar, text: text.replace(/#(local|nepal|learning|learned|lesson)\b/gi, "").trim() };
}

const NOT_LINKED = "This chat is not linked to a PostFlow account. In PostFlow, open Settings and press Connect Telegram.";

/** Links a chat to the account whose one-time code it presents (from the Connect Telegram link). */
async function linkChat(chat: number, code: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(code)) return false;
  const user = await db().query.users.findFirst({ where: eq(schema.users.telegramLinkCode, code) });
  if (!user) return false;
  // A chat belongs to one account at a time.
  await db().update(schema.users).set({ telegramChatId: null }).where(eq(schema.users.telegramChatId, String(chat)));
  await db().update(schema.users).set({ telegramChatId: String(chat), telegramLinkCode: null, updatedAt: new Date() }).where(eq(schema.users.id, user.id));
  return true;
}

/** Handles one Telegram update. A chat only ever acts for the one account it is linked to. */
export async function handleTelegramUpdate(u: Update): Promise<void> {
  const chat = u.message?.chat.id ?? u.callback_query?.message?.chat.id;
  if (!chat) return;

  const start = u.message?.text?.trim().match(/^\/start(?:@\w+)?\s+(\S+)$/);
  if (start) {
    const ok = await linkChat(chat, start[1]);
    await sendTo(chat, ok ? `✅ Linked to PostFlow. New posts will arrive here with buttons.\n\n${HELP}` : "That link has expired or was already used. Open Settings in PostFlow and press Connect Telegram again.");
    return;
  }

  const user = await db().query.users.findFirst({ where: eq(schema.users.telegramChatId, String(chat)) });
  if (!user) {
    if (u.message) await sendTo(chat, NOT_LINKED);
    return;
  }
  if (u.message?.text?.trim() === "/unlink") {
    await db().update(schema.users).set({ telegramChatId: null, updatedAt: new Date() }).where(eq(schema.users.id, user.id));
    await sendTo(chat, "Unlinked. This chat will not receive PostFlow messages any more.");
    return;
  }
  if (!entitlementOf(user).active) {
    await sendTo(chat, "Your PostFlow subscription is not active, so posting is stopped. Choose a plan on the Billing page to continue.");
    return;
  }
  await withUser(user.id, () => handleForUser(u, chat));
}

async function handleForUser(u: Update, chat: number): Promise<void> {
  const userId = await uid();

  if (u.callback_query) {
    const data = u.callback_query.data ?? "";
    let answer = "Done";
    if (data.startsWith("ok:")) {
      try {
        await approvePost(data.slice(3));
        answer = "✅ Approved. It goes out at its scheduled time.";
      } catch (err) {
        answer = err instanceof PostError ? err.message : "Could not approve it.";
      }
    } else if (data.startsWith("rj:")) {
      // Finding and writing a replacement takes a while; acknowledge first, the new post arrives as its own message.
      await telegramApi("answerCallbackQuery", { callback_query_id: u.callback_query.id, text: "Rejected. Looking for another story…" });
      const id = data.slice(3);
      const run = () =>
        withUser(userId, async () => {
          const r = await rejectAndReplace(id).catch((err: Error) => ({ replacementId: null, message: err.message }));
          if (!r.replacementId) await sendTo(chat, r.message);
        });
      try {
        after(run);
      } catch {
        await run(); // outside a request (tests)
      }
      return;
    } else if (data.startsWith("rw:")) {
      // Same story and facts, written again from a different angle. Takes a moment, so acknowledge first.
      await telegramApi("answerCallbackQuery", { callback_query_id: u.callback_query.id, text: "Writing it again…" });
      const id = data.slice(3);
      const run = () =>
        withUser(userId, async () => {
          try {
            const r = await rewordPost(id, QUICK_REWORD, false);
            await sendTo(chat, `✍️ New wording\n\n${r.text}${r.reasons.length ? `\n\nReviewer concerns: ${r.reasons.join(" · ")}` : ""}`, postButtons(id));
          } catch (err) {
            await sendTo(chat, (err as Error).message);
          }
        });
      try {
        after(run);
      } catch {
        await run(); // outside a request (tests)
      }
      return;
    } else if (data.startsWith("pn:")) {
      // Posting for real cannot be undone, so ask first.
      const p = await db().query.posts.findFirst({ where: and(eq(schema.posts.id, data.slice(3)), eq(schema.posts.userId, userId)) });
      if (!p || !["scheduled", "draft", "failed", "cancelled"].includes(p.status)) {
        answer = "That post is not waiting to go out any more.";
      } else {
        await telegramApi("answerCallbackQuery", { callback_query_id: u.callback_query.id });
        await sendTo(chat, `🚀 Post this on ${p.platform === "x" ? "X" : "LinkedIn"} right now, ahead of its schedule?\n\n${p.text}`, [[{ text: "🚀 Yes, post now", data: `py:${p.id}` }, { text: "Cancel", data: "no:" }]]);
        return;
      }
    } else if (data.startsWith("py:")) {
      if ((await getSettings()).paused) {
        answer = "Posting is paused. Send /resume first.";
      } else {
        try {
          await postNow(data.slice(3));
          answer = "🚀 Posting now…";
          const run = () => withUser(userId, () => publishDue().then(() => undefined));
          try {
            after(run);
          } catch {
            await run(); // outside a request (tests)
          }
        } catch (err) {
          answer = err instanceof PostError ? err.message : "Could not post it.";
        }
      }
    } else if (data === "no:") {
      answer = "Cancelled. Nothing was posted.";
    } else if (data.startsWith("rm:")) {
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
  if (text === "/fill") {
    try {
      const msg = await requestFillNow(userId, (job) => {
        try {
          after(job);
        } catch {
          // outside a request (tests): the scheduler picks it up
        }
      });
      return void (await sendTo(chat, `⏳ ${msg} It takes a few minutes, and I will message you when it is done.`));
    } catch (err) {
      return void (await sendTo(chat, (err as Error).message));
    }
  }
  if (text === "/queue") {
    const q = await upcoming(40);
    if (!q.length) return void (await sendTo(chat, "Nothing scheduled yet."));
    const gate_ = approvalGate(s, (await entitlementFor(userId)).features.autoMode);
    const approvalOn = gate_.blocks;
    const waiting = (p: (typeof q)[number]) => gate_.blocks && !p.approvedAt;
    const tag = (p: (typeof q)[number]) => (gate_.blocks ? (p.approvedAt ? " · ✅ approved" : " · ⏳ needs your OK, skipped if not approved in time") : "");
    const now = DateTime.now().setZone(s.timezone);
    const dayLabel = (d: DateTime) => {
      const diff = Math.round(d.startOf("day").diff(now.startOf("day"), "days").days);
      const date = d.toFormat("ccc d LLL");
      return diff === 0 ? `Today · ${date}` : diff === 1 ? `Tomorrow · ${date}` : d.toFormat("cccc · d LLL");
    };
    const days = new Map<string, { label: string; posts: typeof q }>();
    for (const p of q) {
      const d = DateTime.fromJSDate(p.scheduledAt, { zone: s.timezone });
      const key = d.toISODate()!;
      if (!days.has(key)) days.set(key, { label: dayLabel(d), posts: [] });
      days.get(key)!.posts.push(p);
    }
    const nWaiting = q.filter(waiting).length;
    await sendTo(chat, `🗓 ${q.length} scheduled post${q.length === 1 ? "" : "s"} over ${days.size} day${days.size === 1 ? "" : "s"}${approvalOn ? (nWaiting ? ` · ${nWaiting} waiting for your OK` : " · all approved") : ""}`);
    let n = 0;
    for (const day of days.values()) {
      // One message per day, with the full text of every post and its own buttons.
      const rows: { text: string; data: string }[][] = [];
      let body = `📅 ${day.label}`;
      day.posts.forEach((p, i) => {
        n++;
        const time = DateTime.fromJSDate(p.scheduledAt, { zone: s.timezone }).toFormat("HH:mm");
        body += `\n\n${i + 1}. ${p.platform === "x" ? "X" : "LinkedIn"} · ${time}${tag(p)}\n${p.text}`;
        const row = [];
        if (waiting(p)) row.push({ text: `✅ Approve ${i + 1}`, data: `ok:${p.id}` });
        row.push({ text: `🚀 Now ${i + 1}`, data: `pn:${p.id}` });
        row.push({ text: `🗑 Remove ${i + 1}`, data: `rm:${p.id}` });
        rows.push(row);
        // Not keen on it? A different story, or the same story written again.
        rows.push([{ text: `🔁 Another story ${i + 1}`, data: `rj:${p.id}` }, { text: `✍️ New wording ${i + 1}`, data: `rw:${p.id}` }]);
      });
      // Telegram messages hold 4,000 characters; a very long day is split per post.
      if (body.length <= 3900) await sendTo(chat, body, rows);
      else {
        await sendTo(chat, `📅 ${day.label}`);
        for (const [i, p] of day.posts.entries()) {
          const time = DateTime.fromJSDate(p.scheduledAt, { zone: s.timezone }).toFormat("HH:mm");
          await sendTo(chat, `${i + 1}. ${p.platform === "x" ? "X" : "LinkedIn"} · ${time}${tag(p)}\n${p.text}`, [rows[i]]);
        }
      }
    }
    return;
  }
  const cmd = text.match(/^\/(post|now|draft|mine)(?:@\w+)?\s*([\s\S]*)$/i);
  if (cmd) {
    const mode: RequestMode = cmd[1] === "now" ? "soon" : cmd[1] === "draft" ? "draft" : "schedule";
    try {
      const req = await createRequest({ text: cmd[2], mode, via: "telegram", own: cmd[1].toLowerCase() === "mine" });
      await sendTo(chat, `✍️ On it. I will write it for ${req.platforms.length > 1 ? "LinkedIn and X" : "your platform"}${mode === "draft" ? " as drafts" : ""}. Expect it here in a minute or two.`);
      try {
        after(() => withUser(userId, () => processRequests({ max: 1 }).then(() => undefined)));
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
  const [row] = await db().insert(schema.notes).values({ userId, text: note.text.slice(0, 4000), pillar: note.pillar, via: "telegram" }).returning();
  const pending = await db().select({ id: schema.notes.id }).from(schema.notes).where(and(eq(schema.notes.userId, userId), eq(schema.notes.pillar, note.pillar))).orderBy(desc(schema.notes.createdAt)).limit(50);
  await sendTo(chat, `📝 Saved (${note.pillar.replace("_", " ")}). I will turn it into a post for an upcoming slot. ${pending.length} note(s) in this category.`);
  void row;
}
