// The Settings home: grouped rows like a phone's own Settings app. Each row shows the current value
// and opens its own page; the two on/off settings are switches right in the list.
// Pattern: "Grouped settings list" from Design Lounge (https://www.designlounge.live/demo/ios-grouped-settings).

import Link from "next/link";
import type { ReactNode } from "react";
import { asc, count, eq, and, ne } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { approvalGate, postsThisMonth } from "@/server/billing/plans";
import { telegramConfigured } from "@/server/telegram";
import { contactEmail } from "@/server/env";
import { toneLabel } from "@/lib/tones";
import { Avatar, Icon } from "@/components/ui";
import { toggleApprovalAction, togglePauseAction } from "@/app/actions";
import { logoutAction } from "@/app/auth-actions";
import { settingsContext } from "./sections";
import { RowLink } from "./settings-shell";

type IconName = Parameters<typeof Icon>[0]["name"];

function Tile({ icon }: { icon: IconName }) {
  return (
    <span aria-hidden="true" className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-[var(--accent-soft)] text-[var(--accent)]">
      <Icon name={icon} size={18} />
    </span>
  );
}

function Group({ title, foot, children }: { title?: string; foot?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-7">
      {title && <h2 className="mb-2 px-4 text-[13px] font-semibold text-[var(--muted)]">{title}</h2>}
      <ul className="overflow-hidden rounded-[14px] bg-[var(--surface)] [&>li+li]:border-t [&>li+li]:border-[var(--line)]">{children}</ul>
      {foot && <p className="mt-2 px-4 text-[13px] leading-relaxed text-[var(--muted)]">{foot}</p>}
    </section>
  );
}

/** A row that opens a page: icon, label, the current value, a chevron. */
function Row({ href, icon, label, value, tone }: { href: string; icon: IconName; label: string; value?: string; tone?: "warn" }) {
  return (
    <li>
      <RowLink href={href}>
        <Tile icon={icon} />
        <span className="min-w-0 flex-1 truncate text-[15px]">{label}</span>
        {value && <span className={`max-w-[45%] truncate text-right text-[14px] ${tone === "warn" ? "font-semibold text-[var(--warn)]" : "text-[var(--muted)]"}`}>{value}</span>}
        <Icon name="right" size={16} className="flex-none text-[var(--subtle)]" />
      </RowLink>
    </li>
  );
}

/** A row with a switch. Pressing it saves straight away; the label says what "on" means. */
function SwitchRow({ icon, label, hint, on, action }: { icon: IconName; label: string; hint: string; on: boolean; action: (f: FormData) => Promise<void> }) {
  return (
    <li>
      <form action={action}>
        <input type="hidden" name="back" value="list" />
        <button type="submit" role="switch" aria-checked={on} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--raised)] focus-visible:outline-offset-[-2px]">
          <Tile icon={icon} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px]">{label}</span>
            <span className="block text-[12px] text-[var(--muted)]">{hint}</span>
          </span>
          <span aria-hidden="true" className={`relative h-[31px] w-[51px] flex-none rounded-full transition-colors duration-[280ms] ${on ? "bg-[var(--good)]" : "bg-[var(--line)]"}`}>
            <span className={`absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,.2)] transition-transform duration-[280ms] [transition-timing-function:cubic-bezier(.32,.72,0,1)] ${on ? "translate-x-[20px]" : ""}`} />
          </span>
        </button>
      </form>
    </li>
  );
}

export async function SettingsList() {
  const { user, ent, s, showX } = await settingsContext();
  const accounts = await db().select().from(schema.platformAccounts).where(eq(schema.platformAccounts.userId, user.id)).orderBy(asc(schema.platformAccounts.platform));
  const linked = (p: string) => accounts.find((a) => a.platform === p && a.status === "connected");
  const [{ n: feeds }] = await db().select({ n: count() }).from(schema.sources).where(and(eq(schema.sources.userId, user.id), eq(schema.sources.enabled, true), ne(schema.sources.url, "tips://manual")));
  const used = ent.plan === "owner" ? null : await postsThisMonth(user.id);
  const platforms = showX ? ["linkedin", "x"] : ["linkedin"];
  const perWeek = s.slots.filter((x) => platforms.includes(x.platform)).reduce((n, x) => n + x.days.length, 0);
  const approvalOn = approvalGate(s, ent.features.autoMode).blocks;
  const include = [s.includeLinks.linkedin && "Link", s.images.linkedin && "Logo", s.hashtags.linkedin && "Hashtags"].filter(Boolean).join(", ") || "Text only";
  const name = s.profile.name || user.name || user.email;
  const contact = contactEmail();

  return (
    <div>
      <h1 className="display mb-5 px-1 text-[32px] sm:text-[36px]">Settings</h1>

      <Group>
        <li>
          <RowLink href="/settings/you" tall>
            <Avatar name={name} size={52} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[18px] font-semibold">{name}</span>
              <span className="block truncate text-[13px] text-[var(--muted)]">{s.profile.role || "Add what you do"}</span>
            </span>
            <Icon name="right" size={16} className="flex-none text-[var(--subtle)]" />
          </RowLink>
        </li>
      </Group>

      <Group title="Your posts">
        <Row href="/settings/you#voice" icon="pencil" label="How you sound" value={toneLabel(s.profile.voice)} />
        <Row href="/settings/you#style" icon="draft" label="What posts include" value={include} />
        <Row href="/settings/times" icon="clock" label="Posting times" value={`${perWeek} a week`} />
        <Row href="/settings/times#breaking" icon="bolt" label="Breaking news" value={s.fastLane.enabled && ent.features.fastLane ? "On" : "Off"} />
        <Row href="/settings/sources" icon="notes" label="News sources" value={String(feeds)} />
      </Group>

      <Group title="Connections">
        <Row href="/settings/accounts" icon="link" label="LinkedIn" value={linked("linkedin") ? "Connected" : "Not connected"} tone={linked("linkedin") ? undefined : "warn"} />
        {showX && <Row href="/settings/accounts" icon="link" label="X" value={linked("x") ? "Connected" : "Not connected"} />}
        <Row href="/settings/accounts#telegram" icon="send" label="Telegram" value={user.telegramChatId ? "Linked" : telegramConfigured() ? "Not linked" : "Coming soon"} />
      </Group>

      <Group title="PostFlow" foot={s.paused ? "Paused: nothing is written or posted until you switch it back on." : "When on, PostFlow keeps finding stories and writing posts for you to approve."}>
        <SwitchRow icon="play" label="PostFlow is on" hint={s.paused ? "Paused" : "Writing and posting"} on={!s.paused} action={togglePauseAction} />
        {ent.features.autoMode ? (
          <SwitchRow icon="check" label="Ask me before posting" hint={approvalOn ? "Nothing goes out without your OK" : "Checked posts go out by themselves"} on={approvalOn} action={toggleApprovalAction} />
        ) : (
          <Row href="/settings/accounts" icon="check" label="Ask me before posting" value="Always" />
        )}
        <Row href="/settings/more" icon="settings" label="More options" />
      </Group>

      <Group title="Account">
        {used !== null && <Row href="/billing" icon="chart" label={ent.plan === "beta" ? "Free beta" : "Plan"} value={`${used} of ${ent.quota.postsPerMonth} posts`} />}
        <Row href="/account" icon="shield" label="Email and password" />
        {user.isOwner && <Row href="/admin" icon="alert" label="Admin" />}
        {contact && (
          <li>
            <a href={`mailto:${contact}`} className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--raised)]">
              <Tile icon="comment" />
              <span className="min-w-0 flex-1 text-[15px]">Get help</span>
              <span className="truncate text-[14px] text-[var(--muted)]">{contact}</span>
            </a>
          </li>
        )}
        <li>
          <form action={logoutAction}>
            <button className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-[var(--bad)] transition-colors hover:bg-[var(--raised)]">
              <span aria-hidden="true" className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-[var(--bad-soft)]"><Icon name="x" size={18} /></span>
              Sign out
            </button>
          </form>
        </li>
      </Group>
    </div>
  );
}
