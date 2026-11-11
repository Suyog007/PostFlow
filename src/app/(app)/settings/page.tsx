import Link from "next/link";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { approvalGate, postsThisMonth } from "@/server/billing/plans";
import { telegramConfigured } from "@/server/telegram";
import { contactEmail } from "@/server/env";
import { fieldOf } from "@/lib/fields";
import { splitNever, toneOf, toneSamples, toneSummary } from "@/lib/tones";
import { Avatar, Icon, PlatformGlyph } from "@/components/ui";
import { logoutAction } from "@/app/auth-actions";
import { settingsContext } from "./sections";

/** Old links used ?tab=…; they now open that setting's own page. */
const OLD: Record<string, string> = { you: "you", voice: "you", times: "times", schedule: "times", accounts: "accounts", general: "accounts", sources: "sources", more: "more", advanced: "more" };

type IconName = Parameters<typeof Icon>[0]["name"];

function list(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "Weekdays at 9:15 AM", "Tue and Thu at 5:30 PM". */
function slotWords(days: number[], time: string) {
  const d = [...days].sort((a, b) => a - b).join(",");
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const when = d === "1,2,3,4,5,6,7" ? "Every day" : d === "1,2,3,4,5" ? "Weekdays" : d === "6,7" ? "Weekends" : list(days.map((n) => names[n - 1]));
  return `${when} at ${DateTime.fromFormat(time, "HH:mm").toFormat("h:mm a")}`;
}

function Row({ href, icon, title, body }: { href: string; icon: IconName; title: string; body: string }) {
  return (
    <li>
      <Link href={href} className="flex items-start gap-4 px-5 py-5 transition-colors hover:bg-[var(--raised)] sm:px-6">
        <span aria-hidden="true" className="flex h-12 w-12 flex-none items-center justify-center rounded-[14px] bg-[var(--raised)] text-[var(--accent)]"><Icon name={icon} size={22} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[18px] font-semibold">{title}</span>
          <span className="mt-1 block text-[16px] leading-relaxed text-[var(--muted)]">{body}</span>
        </span>
        <Icon name="right" size={18} className="mt-1 flex-none text-[var(--subtle)]" />
      </Link>
    </li>
  );
}

export default async function SettingsHub({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; connected?: string; tab?: string }> }) {
  const sp = await searchParams;
  const to = sp.connected ? "accounts" : OLD[sp.tab ?? ""];
  if (to) {
    const q = new URLSearchParams(Object.entries({ ok: sp.ok, error: sp.error, connected: sp.connected }).filter((e): e is [string, string] => !!e[1]));
    redirect(`/settings/${to}${q.size ? `?${q}` : ""}`);
  }

  const { user, ent, s, showX } = await settingsContext();
  const field = fieldOf(s.profile.field);
  const accounts = await db().select().from(schema.platformAccounts).where(eq(schema.platformAccounts.userId, user.id));
  const linkedin = accounts.some((a) => a.platform === "linkedin" && a.status === "connected");
  const used = ent.plan === "owner" ? null : await postsThisMonth(user.id);
  const approvalOn = approvalGate(s, ent.features.autoMode).blocks;
  const tz = s.timezone;

  const topics = s.profile.expertise.length ? list(s.profile.expertise.slice(0, 4)) : field.label;
  const never = splitNever(s.profile.avoid).slice(0, 3).map((x) => x.charAt(0).toLowerCase() + x.slice(1));
  const writeAbout = `${topics.charAt(0).toUpperCase()}${topics.slice(1)} news${s.profile.region ? ` in ${s.profile.region}` : ""}.${never.length ? ` Never ${list(never)}.` : ""}`;
  const slots = s.slots.filter((x) => x.platform === "linkedin" || showX);
  const perWeek = slots.reduce((n, x) => n + x.days.length, 0);
  const when = slots.length
    ? `${perWeek} ${perWeek === 1 ? "time" : "times"} a week: ${slots.slice(0, 2).map((x) => slotWords(x.days, x.time)).join("; ")}${slots.length > 2 ? "; and more" : ""}. ${approvalOn ? "Nothing goes out until you say yes." : "Checked posts go out by themselves."}`
    : "No posting times yet. Add one.";
  const tg = user.telegramChatId ? "Telegram is linked." : telegramConfigured() ? "Telegram is optional, not added yet." : "";
  const accountsLine = `${linkedin ? "LinkedIn is connected." : "LinkedIn is not connected yet."} ${tg}`.trim();
  const resets = DateTime.now().setZone(tz).startOf("month").plus({ months: 1 }).toFormat("d LLLL");

  // The preview: their latest real post if there is one, else the sample in the voice they picked.
  const [latest] = await db().select().from(schema.posts).where(and(eq(schema.posts.userId, user.id), inArray(schema.posts.status, ["scheduled", "published", "publishing"]))).orderBy(desc(schema.posts.createdAt)).limit(1);
  const sample = toneSamples(field.id).find((t) => t.id === (toneOf(s.profile.voice)?.id ?? "warm"))!.sample;
  const name = s.profile.name || user.name || user.email;
  const contact = contactEmail();

  return (
    <div>
      <h1 className="display text-[38px] leading-tight sm:text-[52px]">Your settings</h1>
      <p className="mt-2 max-w-[60ch] text-[17px] text-[var(--muted)]">How PostFlow writes for you. Open a row to change anything.</p>
      {sp.error && <p role="alert" className="mt-4 rounded-[14px] bg-[var(--bad-soft)] px-4 py-3 text-[15px] text-[var(--bad)]">{sp.error}</p>}

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
        <div>
          <ul className="overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--surface)] shadow-[0_16px_32px_-26px_rgba(27,36,32,.4)] [&>li+li]:border-t [&>li+li]:border-[var(--line)]">
            <Row href="/settings/you" icon="pencil" title="Your voice" body={toneSummary(s.profile.voice)} />
            <Row href="/settings/topics" icon="notes" title="What to write about" body={writeAbout} />
            <Row href="/settings/times" icon="clock" title="When to post" body={when} />
            <Row href="/settings/accounts" icon="shield" title="Your accounts" body={accountsLine} />
          </ul>

          {used !== null && <p className="mt-5 px-1 text-[16px] text-[var(--muted)]">PostFlow has written {used} of your {ent.quota.postsPerMonth} posts this month. Posts you skip don&apos;t count. The count resets on {resets}.</p>}
          <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2 px-1 text-[16px]">
            <Link href="/settings/sources" className="text-[var(--accent)] hover:underline">News sources</Link>
            <Link href="/settings/more" className="text-[var(--accent)] hover:underline">More options</Link>
            <Link href="/account" className="text-[var(--accent)] hover:underline">Email and password</Link>
            {user.isOwner && <Link href="/admin" className="text-[var(--accent)] hover:underline">Admin</Link>}
            {contact && <a href={`mailto:${contact}`} className="text-[var(--accent)] hover:underline">Get help</a>}
          </p>
          <form action={logoutAction} className="mt-4 px-1"><button className="text-[16px] font-semibold underline underline-offset-4">Sign out</button></form>
        </div>

        <aside className="hidden lg:block">
          <p className="mb-3 text-[15px] font-semibold text-[var(--muted)]">How a post looks with these settings</p>
          <div className="rounded-[22px] border border-[var(--line-strong)]/60 bg-[var(--surface)] p-6 shadow-[0_18px_36px_-26px_rgba(27,36,32,.45)]">
            <div className="flex items-center gap-3">
              <Avatar name={name} size={52} />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[18px] font-semibold">{name}</p>
                <p className="truncate text-[14px] text-[var(--muted)]">{[s.profile.role || "LinkedIn", "now"].join(" · ")}</p>
              </div>
              <PlatformGlyph platform="linkedin" size={26} />
            </div>
            <p className="post-text mt-4 whitespace-pre-line text-[17px] leading-[1.6]">{latest?.text ?? sample}</p>
            {!latest && <p className="mt-4 text-[13px] text-[var(--subtle)]">A sample in your voice. Your real posts appear here once PostFlow has written one.</p>}
          </div>
        </aside>
      </div>

      {sp.ok && (
        <p role="status" className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[var(--ink)] px-5 py-3 text-[16px] font-semibold text-[var(--bg)] shadow-lg md:bottom-10">
          <Icon name="check" size={18} />{sp.ok}
        </p>
      )}
    </div>
  );
}
