import Image from "next/image";
import type { ReactNode } from "react";
import { Icon, PlatformGlyph } from "@/components/ui";

/** A real product screenshot, swapped for its dark version when the visitor uses dark mode. */
export function Shot({ name, alt, width, height, priority, className = "" }: { name: string; alt: string; width: number; height: number; priority?: boolean; className?: string }) {
  const sizes = "(min-width: 1120px) 1040px, 100vw";
  return (
    // fixmyslop-ignore[ui/neon-glow] neutral grey drop shadow under a screenshot, not a coloured glow
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
      <svg width="40" height="28" viewBox="0 0 40 28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="rotate-90 lg:rotate-0">
        <path d="M2 14h28" className="flow-line" />
        <path d="M27 8l7 6-7 6" />
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
          You approve, edit, move or remove. Telegram sends you a heads-up about ten minutes before each post.
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

/** Illustration of how a news story is handled before it becomes a post. */
export function NewsCard() {
  const rows: { icon: "check" | "clock" | "bolt"; tone: string; title: string; body: string }[] = [
    { icon: "check", tone: "text-[var(--good)]", title: "Cross-checked", body: "Reported by 2 independent outlets besides the source." },
    { icon: "clock", tone: "text-[var(--warn)]", title: "Time-sensitive", body: "Stale after 48 hours. Dropped, not posted late." },
    { icon: "bolt", tone: "text-[var(--accent)]", title: "Fast lane", body: "Score 9/10, under 12 hours old: posted in 45 minutes, outside quiet hours." },
  ];
  return (
    // fixmyslop-ignore[ui/neon-glow] neutral grey drop shadow under the card, not a coloured glow
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

/**
 * What a post looks like with its picture. The illustration is drawn here in the same calm, clay-like
 * house style the real pictures use (one object, one accent colour, no words in the image).
 */
export function PicturePostDemo() {
  return (
    <figure className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_1px_0_var(--line),0_24px_48px_-24px_rgba(16,24,40,.25)]">
      <div className="flex items-center gap-3 p-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[14px] font-semibold text-[var(--accent)]" aria-hidden="true">YN</span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold">Your Name</p>
          <p className="truncate text-[12px] text-[var(--subtle)]">Engineer building SaaS products · now</p>
        </div>
        <span className="ml-auto"><PlatformGlyph platform="linkedin" size={18} /></span>
      </div>
      <p className="px-4 pb-3 text-[14px] leading-relaxed">
        A certificate authority signed certificates with keys an attacker could crack in minutes.
        <br />
        <br />
        eMudhra, a company browsers trusted to vouch for websites, is leaving the business after it happened, per The Register. If your site uses one of its certificates, replace it this week.
      </p>
      <svg viewBox="0 0 640 360" role="img" aria-label="Illustration: a huge round vault door held shut by one small orange paper clip" className="block h-auto w-full">
        <defs>
          <radialGradient id="pp-bg" cx="50%" cy="40%" r="75%">
            <stop offset="0%" stopColor="#dfe7ea" />
            <stop offset="100%" stopColor="#b9c7cd" />
          </radialGradient>
          <radialGradient id="pp-door" cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#f3f5f6" />
            <stop offset="100%" stopColor="#a9b5bb" />
          </radialGradient>
          <filter id="pp-soft" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#33434b" floodOpacity=".28" />
          </filter>
        </defs>
        <rect width="640" height="360" fill="url(#pp-bg)" />
        <ellipse cx="320" cy="318" rx="170" ry="16" fill="#5b6b72" opacity=".18" />
        <g filter="url(#pp-soft)">
          <circle cx="320" cy="178" r="128" fill="url(#pp-door)" />
          <circle cx="320" cy="178" r="104" fill="none" stroke="#9aa8ae" strokeWidth="6" opacity=".7" />
          <circle cx="320" cy="178" r="30" fill="#dfe5e8" stroke="#9aa8ae" strokeWidth="5" />
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <rect key={a} x="316" y="96" width="8" height="52" rx="4" fill="#9aa8ae" transform={`rotate(${a} 320 178)`} />
          ))}
        </g>
        {/* The door's seam on the right, and the one paper clip holding it shut. */}
        <path d="M446 120 v116" stroke="#8e9ca3" strokeWidth="4" strokeLinecap="round" opacity=".8" />
        <g transform="translate(428 158) rotate(-8)">
          <path d="M8 0 h40 a14 14 0 0 1 0 28 h-36 a9 9 0 0 1 0 -18 h30" fill="none" stroke="#e8743b" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
      <figcaption className="px-4 py-3 text-[12px] text-[var(--subtle)]">Every post gets a picture drawn for its point. No stock photos, no words in the image.</figcaption>
    </figure>
  );
}
