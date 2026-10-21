import Image from "next/image";
import type { ReactNode } from "react";
import { Icon, PlatformGlyph } from "@/components/ui";

/** A real product screenshot, swapped for its dark version when the visitor uses dark mode. */
export function Shot({ name, alt, width, height, priority, className = "" }: { name: string; alt: string; width: number; height: number; priority?: boolean; className?: string }) {
  const sizes = "(min-width: 1120px) 1040px, 100vw";
  return (
    <div className={`overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_1px_0_var(--line),0_24px_48px_-24px_rgba(16,24,40,.25)] ${className}`}>
      <Image src={`/landing/${name}-light.png`} alt={alt} width={width} height={height} sizes={sizes} priority={priority} className="only-light h-auto w-full" />
      <Image src={`/landing/${name}-dark.png`} alt="" aria-hidden width={width} height={height} sizes={sizes} priority={priority} className="only-dark h-auto w-full" />
    </div>
  );
}

function Node({ icon, title, children, tone }: { icon: ReactNode; title: string; children: ReactNode; tone?: "accent" }) {
  return (
    <div className={`rounded-xl border bg-[var(--surface)] p-4 ${tone === "accent" ? "border-[var(--accent)] shadow-[0_0_0_3px_var(--accent-soft)]" : "border-[var(--line)]"}`}>
      <div className="flex items-center gap-2 text-[14px] font-semibold">
        <span className={`flex h-7 w-7 items-center justify-center rounded-md ${tone === "accent" ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "bg-[var(--side)] text-[var(--ink)]"}`}>{icon}</span>
        {title}
      </div>
      <div className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{children}</div>
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center justify-center text-[var(--subtle)]" aria-hidden="true">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="rotate-90 lg:rotate-0">
        <path d="M4 12h15M14 6.5 19.5 12 14 17.5" />
      </svg>
    </div>
  );
}

/** How a post moves through PostFlow, from your material to the platforms. */
export function FlowDiagram() {
  return (
    <figure>
      <div className="grid gap-2 lg:grid-cols-[1.05fr_auto_1fr_auto_1.15fr_auto_1fr_auto_0.8fr] lg:items-center">
        <div className="grid gap-2">
          <Node icon={<Icon name="notes" size={15} />} title="Your notes">What you built or learned, typed in the app or sent to Telegram.</Node>
          <Node icon={<Icon name="link" size={15} />} title="News and links">Feeds you follow, plus links you paste.</Node>
        </div>
        <Arrow />
        <Node icon={<Icon name="pencil" size={15} />} title="Writer">
          Picks the strongest material for each open slot and writes it for LinkedIn and X separately, in your voice.
        </Node>
        <Arrow />
        <div className="grid gap-2">
          <Node icon={<Icon name="shield" size={15} />} title="Reviewer" tone="accent">
            A second pass scores the draft and checks every claim against the source.
          </Node>
          <div className="rounded-xl border border-dashed border-[var(--line-strong)] px-4 py-3 text-[12px] text-[var(--muted)]">
            <span className="font-medium text-[var(--bad)]">Fails?</span> Rewritten with the reviewer&apos;s notes, up to 3 times. Still failing: rejected, never scheduled.
          </div>
        </div>
        <Arrow />
        <Node icon={<Icon name="calendar" size={15} />} title="Your calendar">
          You approve, edit, move or remove. Each new post is also sent to Telegram with buttons.
        </Node>
        <Arrow />
        <div className="grid gap-2">
          <div className="flex items-center gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-[14px] font-semibold">
            <PlatformGlyph platform="linkedin" size={22} /> LinkedIn
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-[14px] font-semibold">
            <PlatformGlyph platform="x" size={22} /> X
          </div>
        </div>
      </div>
      <figcaption className="mt-4 text-center text-[13px] text-[var(--subtle)]">The scheduler runs every 5 minutes: publish what is due first, then collect, write and review.</figcaption>
    </figure>
  );
}

/** Illustration of the Telegram bot, using the bot's real message format. */
export function TelegramMock() {
  return (
    <div className="mx-auto w-full max-w-[400px] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_24px_48px_-24px_rgba(16,24,40,.25)]">
      <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2aabee] text-white">
          <Icon name="send" size={17} />
        </span>
        <div>
          <div className="text-[14px] font-semibold">PostFlow bot</div>
          <div className="text-[12px] text-[var(--subtle)]">bot</div>
        </div>
      </div>
      <div className="space-y-3 bg-[var(--raised)] p-4 text-[13px] leading-relaxed">
        <div className="max-w-[88%] rounded-2xl rounded-tl-md bg-[var(--surface)] p-3 shadow-[0_1px_0_var(--line)]">
          <p className="font-medium">🗓 LinkedIn · Thu 22 Oct, 09:15</p>
          <p className="mt-2 whitespace-pre-line">{"60 people came to our meetup in Lalitpur on building with small models.\n\n💻 Most questions were about running models on cheap laptops."}</p>
          <p className="mt-2 text-[var(--muted)]">It will not be posted until you approve it.</p>
        </div>
        <div className="grid max-w-[88%] grid-cols-2 gap-1.5 text-center text-[12px] font-medium">
          <span className="rounded-lg bg-[var(--surface)] px-2 py-2 shadow-[0_1px_0_var(--line)]">✅ Approve</span>
          <span className="rounded-lg bg-[var(--surface)] px-2 py-2 shadow-[0_1px_0_var(--line)]">🔁 Reject, find another</span>
        </div>
        <div className="ml-auto max-w-[80%] rounded-2xl rounded-tr-md bg-[var(--accent)] p-3 text-[var(--accent-ink)]">
          Shipped invoice exports today. The CSV was easy, the timezone handling took all afternoon.
        </div>
        <div className="max-w-[88%] rounded-2xl rounded-tl-md bg-[var(--surface)] p-3 shadow-[0_1px_0_var(--line)]">
          📝 Saved (own work). I will turn it into a post for an upcoming slot.
        </div>
      </div>
    </div>
  );
}

/** Illustration of how a news story is handled before it becomes a post. */
export function NewsCard() {
  const rows: { icon: "check" | "clock" | "bolt"; tone: string; title: string; body: string }[] = [
    { icon: "check", tone: "text-[var(--good)]", title: "Cross-checked", body: "Reported by 2 independent outlets besides the source." },
    { icon: "clock", tone: "text-[var(--warn)]", title: "Time-sensitive", body: "Stale after 48 hours. Dropped, not posted late." },
    { icon: "bolt", tone: "text-[var(--accent)]", title: "Fast lane", body: "Score 9/10, under 12 hours old: posted in 45 minutes, outside quiet hours." },
  ];
  return (
    <div className="mx-auto w-full max-w-[460px] rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_24px_48px_-24px_rgba(16,24,40,.25)]">
      <div className="flex items-center gap-2 text-[12px] text-[var(--subtle)]">
        <span className="badge badge-accent">News</span> Relevance 9/10 · 3 hours ago
      </div>
      <p className="mt-3 text-[15px] font-semibold leading-snug">A major code host makes CI minutes free for public repositories</p>
      <div className="mt-4 rounded-lg bg-[var(--raised)] p-3 text-[13px] leading-relaxed">
        <p><span className="font-medium">What changed:</span> free CI for public repos.</p>
        <p><span className="font-medium">Why it is an opening:</span> small open-source teams can test for free.</p>
        <p><span className="font-medium">Next step:</span> move your public repo&apos;s checks this week.</p>
      </div>
      <ul className="mt-4 space-y-3">
        {rows.map((r) => (
          <li key={r.title} className="flex gap-3 text-[13px]">
            <Icon name={r.icon} size={16} className={`mt-0.5 flex-none ${r.tone}`} />
            <span><span className="font-medium">{r.title}.</span> <span className="text-[var(--muted)]">{r.body}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the reviewer does with a weak draft: it never reaches the calendar. */
export function RejectedCard() {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex items-center gap-2 text-[12px]">
        <PlatformGlyph platform="x" size={14} />
        <span className="badge badge-bad">Rejected</span>
        <span className="text-[var(--subtle)]">after 3 rounds</span>
      </div>
      <p className="mt-2 text-[14px] text-[var(--muted)] line-through decoration-[var(--bad)]/60">Every AI tool is about to change everything.</p>
      <div className="mt-3 grid grid-cols-3 gap-3 text-[12px]">
        {[
          ["Worth posting", 3],
          ["Facts", 4],
          ["Human", 2],
        ].map(([l, v]) => (
          <div key={l as string}>
            <div className="mb-1 flex justify-between"><span className="text-[var(--muted)]">{l}</span><span className="font-medium tnum">{v}/10</span></div>
            <div className="h-1.5 rounded-full bg-[var(--side)]"><div className="h-1.5 rounded-full bg-[var(--bad)]" style={{ width: `${(v as number) * 10}%` }} /></div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-[var(--bad)]">Prediction stated as fact · No source</p>
    </div>
  );
}
