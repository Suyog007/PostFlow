import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { uid, withUser } from "./context";
import { approvalGate, entitlementFor, entitlementOf } from "./billing/plans";
import { DateTime } from "luxon";
import { isPrivateChatId, sendPhotoTo, sendTo, telegramApi } from "./telegram";
import { cardUrl, ensurePostImage, redrawPostImage, wantsImage } from "./post-images";
import { getSettings, saveSettings } from "./settings";
import { approvePost, postNow, removePost, PostError, upcoming } from "./posts";
import { publishDue } from "./publisher";
import { declinePost, refillSlot, rewordPost, writeLesson } from "./generate";
import { requestFillNow, requestRefresh, requestReplacement } from "./tick";
import { formatLocal } from "./slots";
import { consumeToken } from "./users";
import { sendEmail } from "./email";
import { env } from "./env";
import { warnOnError } from "./log";
import { storyLine } from "./story-date";
import type { Pillar } from "./db/schema";
import { after } from "next/server";
import { createRequest, processRequests, retryAnyway, type RequestMode } from "./requests";

interface Chat {
  id: number;
  /** "private" for a one-to-one chat with the bot; "group", "supergroup" or "channel" otherwise. */
  type?: string;
}

interface Update {
  message?: { chat: Chat; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: Chat } };
}

const HELP = `Make a post from something:
/post <idea or link>   write it for LinkedIn and X, next free slots
/now <idea or link>    same, but about 20 minutes from now
/draft <idea or link>  write it, do not schedule
/mine <link>           a link to your own article: written as you, with the link in the post

Other ways to feed me:
- Any plain text is saved as a note (what you built, learned or think). Tags: #local, #learning
- A plain link (an article or an X post) is researched: I read it, follow its links, check other coverage and write a post if it is worth one
/dig <news you heard about>  look it up first, then write a post if it is worth one

/learn  a short, simple lesson for your audience in the next free slots. Add a topic to choose it: /learn how indexes work
/refresh  rewrite every queued post you have not approved, in the latest style
/fill   write posts now for every open slot in the next 5 days
/today  today's posts, with their logos
/tomorrow  tomorrow's posts
/queue  upcoming posts by day, in full. Each has Approve, Post now, Remove, Another story and New wording buttons
/pause  stop all posting
/resume start again
/unlink disconnect this chat from PostFlow`;

const URL_IN = /https?:\/\/\S+/i;

/** Processes a request in the background, then sends what came of it (the posts, or why it was skipped). */
async function runRequest(userId: string, chat: number | string, requestId: string) {
  const run = () =>
    withUser(userId, async () => {
      await processRequests({ max: 3 });
      const req = await db().query.requests.findFirst({ where: eq(schema.requests.id, requestId) });
      // Skipped and failed requests already sent their own message (with "Write it anyway" where it applies).
      if (req?.status !== "done") return;
      if (req.summary) await sendTo(chat, `🔎 ${req.summary}`);
      for (const id of req.postIds) await sendPost(chat, id, "✍️ Ready");
    });
  try {
    after(run);
  } catch {
    // Outside a request (tests): run it now.
    await run();
  }
}

/**
 * Upcoming posts, one message per day with the full text and buttons for each post.
 * `onlyDay` limits it to today (0) or tomorrow (1) in the owner's timezone.
 */
async function showQueue(chat: number | string, userId: string, onlyDay?: 0 | 1) {
  const s = await getSettings();
  const now = DateTime.now().setZone(s.timezone);
  const dayOffset = (d: DateTime) => Math.round(d.startOf("day").diff(now.startOf("day"), "days").days);
  const q = (await upcoming(40)).filter((p) => onlyDay === undefined || dayOffset(DateTime.fromJSDate(p.scheduledAt, { zone: s.timezone })) === onlyDay);
  const which = onlyDay === 0 ? "today" : onlyDay === 1 ? "tomorrow" : "";
  if (!q.length) return void (await sendTo(chat, which ? `Nothing scheduled for ${which}. Send /fill to write posts for open slots, or /learn for a lesson.` : "Nothing scheduled yet."));
  const gate_ = approvalGate(s, (await entitlementFor(userId)).features.autoMode);
  const waiting = (p: (typeof q)[number]) => gate_.blocks && !p.approvedAt;
  const tag = (p: (typeof q)[number]) => (gate_.blocks ? (p.approvedAt ? " · ✅ approved" : " · ⏳ needs your OK, skipped if not approved in time") : "");
  const dayLabel = (d: DateTime) => {
    const diff = dayOffset(d);
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
  // When each news story happened, so a stale one can be swapped out. Never part of the post itself.
  const stories: Record<string, string> = {};
  for (const p of q) stories[p.id] = await storyLine(p, s.timezone);
  const span = which ? ` ${which}` : ` over ${days.size} day${days.size === 1 ? "" : "s"}`;
  await sendTo(chat, `🗓 ${q.length} scheduled post${q.length === 1 ? "" : "s"}${span}${gate_.blocks ? (nWaiting ? ` · ${nWaiting} waiting for your OK` : " · all approved") : ""}`);
  for (const day of days.values()) {
    const line = (p: (typeof q)[number], i: number) =>
      `${i + 1}. ${p.platform === "x" ? "X" : "LinkedIn"} · ${DateTime.fromJSDate(p.scheduledAt, { zone: s.timezone }).toFormat("HH:mm")}${tag(p)}${stories[p.id] ? `\n${stories[p.id]}` : ""}\n${p.text}`;
    const buttonsFor = (p: (typeof q)[number], i: number) => {
      const row = [];
      if (waiting(p)) row.push({ text: `✅ Approve ${i + 1}`, data: `ok:${p.id}` });
      row.push({ text: `🚀 Now ${i + 1}`, data: `pn:${p.id}` });
      row.push({ text: `🗑 Remove ${i + 1}`, data: `rm:${p.id}` });
      // Not keen on it? A different story, or the same story written again.
      return [row, [{ text: `🔁 Another story ${i + 1}`, data: `rj:${p.id}` }, { text: `✍️ New wording ${i + 1}`, data: `rw:${p.id}` }]];
    };
    // Today's few posts come one by one with the picture that will go out with each.
    if (onlyDay === 0) {
      await sendTo(chat, `📅 ${day.label}`);
      for (const [i, p] of day.posts.entries()) {
        const picture = wantsImage(p, s) && !!(await ensurePostImage(p));
        if (!picture) {
          await sendTo(chat, line(p, i), buttonsFor(p, i));
          continue;
        }
        const fresh = (await db().query.posts.findFirst({ where: eq(schema.posts.id, p.id) })) ?? p;
        await sendPhotoTo(chat, cardUrl(fresh), line(p, i), [...buttonsFor(p, i), [{ text: `🔁 Other logo ${i + 1}`, data: `ni:${p.id}` }, { text: `🚫 No logo ${i + 1}`, data: `xi:${p.id}` }]]);
      }
      continue;
    }
    const body = [`📅 ${day.label}`, ...day.posts.map(line)].join("\n\n");
    // Telegram messages hold 4,000 characters; a very long day is split into one message per post.
    if (body.length <= 3900) await sendTo(chat, body, day.posts.flatMap(buttonsFor));
    else {
      await sendTo(chat, `📅 ${day.label}`);
      for (const [i, p] of day.posts.entries()) await sendTo(chat, line(p, i), buttonsFor(p, i));
    }
  }
}

/** Sends one post's full text with its buttons. */
async function sendPost(chat: number | string, id: string, heading: string) {
  const p = await db().query.posts.findFirst({ where: eq(schema.posts.id, id) });
  if (!p) return;
  const s = await getSettings();
  const note = p.status === "draft" ? "\n\nThe reviewer had concerns, so it is a draft: open the app to look at it." : "";
  const story = await storyLine(p, s.timezone);
  const text = `${heading}\n${p.platform === "x" ? "X" : "LinkedIn"} · ${formatLocal(p.scheduledAt, s.timezone)}${story ? `\n${story}` : ""}\n\n${p.text}${note}`;
  const picture = wantsImage(p, s) && !!(await ensurePostImage(p));
  if (picture) await sendPhotoTo(chat, cardUrl(p), text, postButtons(id, true));
  else await sendTo(chat, text, postButtons(id));
}

const QUICK_REWORD = "Take a different angle and a fresh opening. Keep the same story and the same facts.";

/** Buttons under a post you may want to act on. */
function postButtons(id: string, picture = false) {
  return [
    [{ text: "✅ Approve", data: `ok:${id}` }, { text: "🗑 Remove", data: `rm:${id}` }],
    [{ text: "🔁 Another story", data: `rj:${id}` }, { text: "✍️ New wording", data: `rw:${id}` }],
    ...(picture ? [[{ text: "🔁 Other logo", data: `ni:${id}` }, { text: "🚫 No logo", data: `xi:${id}` }]] : []),
  ];
}

function parseNote(text: string): { pillar: Pillar; text: string } {
  // #nepal is kept as an alias of #local for accounts from the single-user version.
  const pillar: Pillar = /#(local|nepal)\b/i.test(text) ? "local" : /#(learning|learned|lesson)\b/i.test(text) ? "learning" : "own_work";
  return { pillar, text: text.replace(/#(local|nepal|learning|learned|lesson)\b/gi, "").trim() };
}

const NOT_LINKED = "This chat is not linked to a PostFlow account. In PostFlow, open Settings and press Connect Telegram.";

const PRIVATE_ONLY = "PostFlow only works in a private chat with this bot, so nobody else can approve or publish your posts. Open the bot directly and press Start there.";

/** Links a private chat to the account whose 15-minute, single-use code it presents (from Connect Telegram). */
async function linkChat(chat: number, code: string): Promise<boolean> {
  const user = await consumeToken(code, "telegram");
  if (!user) return false;
  // A chat belongs to one account at a time.
  await db().update(schema.users).set({ telegramChatId: null }).where(eq(schema.users.telegramChatId, String(chat)));
  await db().update(schema.users).set({ telegramChatId: String(chat), telegramLinkCode: null, updatedAt: new Date() }).where(eq(schema.users.id, user.id));
  // Tell the account holder, so a link they did not make does not go unnoticed.
  await sendEmail({
    to: user.email,
    subject: `Telegram connected to your ${env().COMPANY_NAME} account`,
    text: `A Telegram chat was just connected to your account. It can approve, remove and publish your posts.\n\nIf this was not you, disconnect it in Settings right away and change your password.`,
    action: { label: "Open Settings", url: `${env().APP_URL.replace(/\/$/, "")}/settings#telegram` },
  }).catch(warnOnError("telegram_link_email_failed", { userId: user.id }));
  return true;
}

/** Handles one Telegram update. A chat only ever acts for the one account it is linked to, and only in private. */
export async function handleTelegramUpdate(u: Update): Promise<void> {
  const from = u.message?.chat ?? u.callback_query?.message?.chat;
  if (!from) return;
  const chat = from.id;
  const isPrivate = from.type === "private" && isPrivateChatId(chat);

  const start = u.message?.text?.trim().match(/^\/start(?:@\w+)?\s+(\S+)$/);
  if (start) {
    if (!isPrivate) return void (await sendTo(chat, PRIVATE_ONLY));
    const ok = await linkChat(chat, start[1]);
    await sendTo(chat, ok ? `✅ Linked to PostFlow. New posts will arrive here with buttons.\n\n${HELP}` : "That link has expired or was already used. Links work for 15 minutes. Open Settings in PostFlow and press Connect Telegram again.");
    return;
  }

  const user = await db().query.users.findFirst({ where: eq(schema.users.telegramChatId, String(chat)) });
  if (!user) {
    if (u.message) await sendTo(chat, NOT_LINKED);
    return;
  }
  if (!isPrivate) {
    // Linked before group chats were refused: unlink it rather than let every member act for the account.
    await db().update(schema.users).set({ telegramChatId: null, updatedAt: new Date() }).where(eq(schema.users.id, user.id));
    await sendTo(chat, `Unlinked. ${PRIVATE_ONLY}`);
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
    let removedId: string | null = null;
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
      try {
        await withUser(userId, () => declinePost(id));
      } catch (err) {
        await sendTo(chat, (err as Error).message);
        return;
      }
      // Writing the replacement can outlast the webhook request, so it runs in the background function.
      await requestReplacement(userId, id, (job) => {
        try {
          after(job);
        } catch {
          void job(); // outside a request (tests)
        }
      });
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
    } else if (data.startsWith("ni:")) {
      // Draw the picture again. Takes a few seconds, so acknowledge first; the post comes back with the new one.
      await telegramApi("answerCallbackQuery", { callback_query_id: u.callback_query.id, text: "Looking for another logo…" });
      const id = data.slice(3);
      const run = () =>
        withUser(userId, async () => {
          const p = await db().query.posts.findFirst({ where: and(eq(schema.posts.id, id), eq(schema.posts.userId, userId)) });
          if (!p || !["scheduled", "draft"].includes(p.status)) return void (await sendTo(chat, "That post is not waiting to go out any more."));
          if (!(await redrawPostImage(p))) return void (await sendTo(chat, "No other logo found. The post keeps the one it has."));
          await sendPost(chat, id, "🔁 Other logo");
        });
      try {
        after(run);
      } catch {
        await run(); // outside a request (tests)
      }
      return;
    } else if (data.startsWith("xi:")) {
      const p = await db().query.posts.findFirst({ where: and(eq(schema.posts.id, data.slice(3)), eq(schema.posts.userId, userId)) });
      if (!p) answer = "Post not found.";
      else {
        await db().update(schema.posts).set({ review: { ...((p.review ?? {}) as Record<string, unknown>), noImage: true }, updatedAt: new Date() }).where(eq(schema.posts.id, p.id));
        answer = "🚫 This post will go out without a logo.";
      }
    } else if (data.startsWith("fw:")) {
      // "Write it anyway" after the research said a link or topic was weak.
      await telegramApi("answerCallbackQuery", { callback_query_id: u.callback_query.id, text: "Writing it anyway…" });
      try {
        const req = await retryAnyway(data.slice(3));
        await runRequest(userId, chat, req.id);
      } catch (err) {
        await sendTo(chat, (err as Error).message);
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
    } else if (data.startsWith("fl:") || data.startsWith("fn:")) {
      // Fill a slot you emptied with a lesson (fl) or a news story (fn).
      const lesson = data.startsWith("fl:");
      await telegramApi("answerCallbackQuery", { callback_query_id: u.callback_query.id, text: lesson ? "Writing a lesson…" : "Looking for a story…" });
      const id = data.slice(3);
      const run = () =>
        withUser(userId, async () => {
          try {
            const newId = await refillSlot(id, lesson ? "lesson" : "news");
            await sendPost(chat, newId, lesson ? "🎓 Lesson for that slot" : "📰 Story for that slot");
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
    } else if (data.startsWith("rm:")) {
      try {
        await removePost(data.slice(3));
        removedId = data.slice(3);
        answer = "Removed. It will not be posted.";
      } catch (err) {
        answer = err instanceof PostError ? err.message : "Could not remove it.";
      }
    }
    await telegramApi("answerCallbackQuery", { callback_query_id: u.callback_query.id, text: answer });
    if (removedId) {
      // An empty slot is unlikely to fill itself with something good soon, so offer to fill it.
      await sendTo(chat, "🗑 Removed. It will not be posted. Want to put something else in that slot?", [[{ text: "🎓 Fill with a lesson", data: `fl:${removedId}` }, { text: "📰 Fill with news", data: `fn:${removedId}` }]]);
      return;
    }
    await sendTo(chat, answer);
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
  const learn = text.match(/^\/learn(?:@\w+)?\s*([\s\S]*)$/i);
  if (learn) {
    const topic = learn[1].trim();
    await sendTo(chat, topic ? `🎓 Writing a short lesson on "${topic.slice(0, 80)}" for the next free slots. Expect it here in a minute or two.` : "🎓 Picking a topic from your expertise and writing a short lesson for the next free slots. Expect it here in a minute or two.");
    const run = () =>
      withUser(userId, async () => {
        try {
          const ids = await writeLesson({ topic: topic || undefined });
          for (const id of ids) await sendPost(chat, id, "🎓 Lesson");
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
  }
  if (text === "/refresh") {
    try {
      const msg = await requestRefresh(userId, (job) => {
        try {
          after(job);
        } catch {
          // outside a request (tests): nothing runs in the background
        }
      });
      return void (await sendTo(chat, `⏳ ${msg} It takes a few minutes; I will message you when it is done.`));
    } catch (err) {
      return void (await sendTo(chat, (err as Error).message));
    }
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
  if (text === "/queue") return void (await showQueue(chat, userId));
  if (text === "/today") {
    // Pictures can take a few seconds each the first time, so answer Telegram first and send them after.
    const run = () => withUser(userId, () => showQueue(chat, userId, 0));
    try {
      after(run);
    } catch {
      await run(); // outside a request (tests)
    }
    return;
  }
  if (text === "/tomorrow") return void (await showQueue(chat, userId, 1));
  const cmd = text.match(/^\/(post|now|draft|mine|dig)(?:@\w+)?\s*([\s\S]*)$/i);
  const plainLink = /^https?:\/\/\S+$/i.test(text);
  if (cmd || plainLink) {
    const verb = cmd ? cmd[1].toLowerCase() : "dig";
    const body = cmd ? cmd[2] : text;
    const mode: RequestMode = verb === "now" ? "soon" : verb === "draft" ? "draft" : "schedule";
    const researched = verb === "dig" || URL_IN.test(body);
    try {
      const req = await createRequest({ text: body, mode, via: "telegram", own: verb === "mine", research: verb === "dig" });
      await sendTo(
        chat,
        researched && verb !== "mine"
          ? "🔎 Looking into it: reading it, following its links and checking what other publishers say. If it is worth a post I will write it; if not, I will tell you why. Give me a minute or two."
          : `✍️ On it. I will write it for ${req.platforms.length > 1 ? "LinkedIn and X" : "your platform"}${mode === "draft" ? " as drafts" : ""}. Expect it here in a minute or two.`,
      );
      await runRequest(userId, chat, req.id);
    } catch (err) {
      await sendTo(chat, (err as Error).message);
    }
    return;
  }
  if (text.startsWith("/")) return void (await sendTo(chat, HELP));

  const note = parseNote(text);
  if (note.text.length < 15) return void (await sendTo(chat, "That is too short to build a post from. Add a little more detail."));
  const [row] = await db().insert(schema.notes).values({ userId, text: note.text.slice(0, 4000), pillar: note.pillar, via: "telegram" }).returning();
  const pending = await db().select({ id: schema.notes.id }).from(schema.notes).where(and(eq(schema.notes.userId, userId), eq(schema.notes.pillar, note.pillar))).orderBy(desc(schema.notes.createdAt)).limit(50);
  await sendTo(chat, `📝 Saved (${note.pillar.replace("_", " ")}). I will turn it into a post for an upcoming slot. ${pending.length} note(s) in this category.`);
  void row;
}
