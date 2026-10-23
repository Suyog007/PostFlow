"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, PlatformGlyph } from "@/components/ui";

const STEPS = [
  { t: "Connect your accounts", b: "Sign in with LinkedIn and X through their official pages. Pick your posting times, like every day at 09:15 and 19:15." },
  { t: "Tell it who you are", b: "Your role, what you can credibly talk about, how you sound, and topics to avoid. This is what keeps posts sounding like you." },
  { t: "Drop rough notes", b: "\"Cut CI from 14 to 4 minutes, the cache did most of it.\" Type it in the app or send it to the Telegram bot." },
  { t: "Approve and forget", b: "Posts appear on your calendar days ahead. About ten minutes before each one, Telegram asks for your OK. No answer means it is skipped, never posted by surprise." },
];

function Pill({ tone, children }: { tone: "good" | "warn" | "plain"; children: ReactNode }) {
  const cls = tone === "good" ? "bg-[var(--good-soft)] text-[var(--good)]" : tone === "warn" ? "bg-[var(--warn-soft)] text-[var(--warn)]" : "bg-[var(--side)] text-[var(--muted)]";
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium ${cls}`}>{children}</span>;
}

function Accounts() {
  const rows = [
    { p: "linkedin" as const, name: "LinkedIn", note: "Posts as you, through the official API" },
    { p: "x" as const, name: "X", note: "Posts as you, through the official API" },
  ];
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.p} className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3.5">
          <PlatformGlyph platform={r.p} size={26} />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold">{r.name}</p>
            <p className="text-[12px] text-[var(--muted)]">{r.note}</p>
          </div>
          <Pill tone="good"><Icon name="check" size={11} /> Connected</Pill>
        </div>
      ))}
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-[var(--line-strong)] p-3.5 text-[13px] text-[var(--muted)]">
        <Icon name="send" size={18} /> Telegram is optional: approve and send notes from your phone.
      </div>
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3.5 text-[13px]">
        <p className="mb-2 text-[12px] font-medium text-[var(--muted)]">Posting times</p>
        <div className="flex flex-wrap gap-1.5">
          {["LinkedIn 09:15", "LinkedIn 19:15", "X 09:30", "X 19:30"].map((t) => (
            <span key={t} className="rounded-md border border-[var(--line)] bg-[var(--raised)] px-2 py-1 text-[12px] tabular-nums">{t}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Profile() {
  return (
    <div className="space-y-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-[13px]">
      <div>
        <p className="text-[12px] font-medium text-[var(--muted)]">Role</p>
        <p className="mt-0.5 text-[14px]">Senior software engineer, building SaaS products</p>
      </div>
      <div>
        <p className="text-[12px] font-medium text-[var(--muted)]">You can credibly write about</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {["Next.js and React", "AI tools for developers", "Shipping a SaaS", "Serverless deploys"].map((t) => (
            <span key={t} className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[12px] text-[var(--accent)]">{t}</span>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[12px] font-medium text-[var(--muted)]">Voice</p>
        <p className="mt-0.5">Direct, practical and specific. Plain words. No hype.</p>
      </div>
      <div>
        <p className="text-[12px] font-medium text-[var(--muted)]">Never write about</p>
        <p className="mt-0.5">Politics, my employer, claims nobody has verified.</p>
      </div>
    </div>
  );
}

function Notes() {
  return (
    <div className="space-y-2.5 text-[13px] leading-relaxed">
      <div className="ml-auto max-w-[82%] rounded-2xl rounded-tr-md bg-[var(--accent)] p-3 text-[var(--accent-ink)]">Cut CI from 14 minutes to 4. The dependency cache did most of it.</div>
      <div className="max-w-[82%] rounded-2xl rounded-tl-md border border-[var(--line)] bg-[var(--surface)] p-3">Saved as a note. I will turn it into a post for an upcoming slot.</div>
      <div className="rounded-xl border border-dashed border-[var(--line-strong)] p-3 text-[12.5px] text-[var(--muted)]">
        <Icon name="link" size={14} className="mr-1.5 inline" /> Paste a link instead and it becomes a story tip, cross-checked against other publishers before it is used.
      </div>
    </div>
  );
}

function Week() {
  const days = ["Fri", "Sat", "Sun", "Mon"];
  const cells: Record<string, { p: "linkedin" | "x"; t: string; s: "ok" | "wait" }[]> = {
    Fri: [{ p: "linkedin", t: "09:15", s: "wait" }, { p: "x", t: "09:30", s: "ok" }, { p: "linkedin", t: "19:15", s: "ok" }],
    Sat: [{ p: "linkedin", t: "09:15", s: "ok" }, { p: "x", t: "09:30", s: "ok" }],
    Sun: [{ p: "linkedin", t: "09:15", s: "ok" }, { p: "linkedin", t: "19:15", s: "wait" }],
    Mon: [{ p: "linkedin", t: "09:15", s: "wait" }, { p: "x", t: "09:30", s: "wait" }],
  };
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3.5">
      <div className="grid grid-cols-4 gap-2">
        {days.map((d) => (
          <div key={d} className="space-y-1.5">
            <p className="text-center text-[11.5px] font-medium text-[var(--subtle)]">{d}</p>
            {cells[d].map((c) => (
              <div key={c.t + c.p} className={`rounded-md border px-1.5 py-1.5 text-[11px] ${c.s === "ok" ? "border-[var(--line)] bg-[var(--raised)]" : "border-[var(--warn)] bg-[var(--warn-soft)]"}`}>
                <div className="flex items-center gap-1 tabular-nums"><PlatformGlyph platform={c.p} size={11} />{c.t}</div>
                <div className={c.s === "ok" ? "text-[var(--good)]" : "text-[var(--warn)]"}>{c.s === "ok" ? "Approved" : "Needs OK"}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-[var(--muted)]">Anything you do not approve before its time is skipped. The calendar simply moves on.</p>
    </div>
  );
}

const VISUALS = [<Accounts key="a" />, <Profile key="p" />, <Notes key="n" />, <Week key="w" />];

export function ScrollSteps() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: "-40% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
      <ol>
        {STEPS.map((s, i) => (
          <li
            key={s.t}
            data-step={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="flex gap-4 py-6 lg:min-h-[44vh] lg:items-center lg:py-10"
          >
            <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-full border text-[14px] font-semibold transition-colors duration-300 ${active === i ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]" : "border-[var(--line-strong)] text-[var(--muted)]"}`}>{i + 1}</span>
            <div className={`transition-opacity duration-300 ${active === i ? "lg:opacity-100" : "lg:opacity-45"}`}>
              <h3 className="text-[20px] font-semibold tracking-tight">{s.t}</h3>
              <p className="mt-1.5 max-w-[460px] text-[15px] leading-relaxed text-[var(--muted)]">{s.b}</p>
              {/* On small screens each step shows its own picture instead of the sticky panel. */}
              <div className="mt-5 lg:hidden">{VISUALS[i]}</div>
            </div>
          </li>
        ))}
      </ol>

      <div className="hidden lg:block">
        <div className="sticky top-28">
          <div className="relative min-h-[360px] rounded-2xl border border-[var(--line)] bg-[var(--raised)] p-5">
            {VISUALS.map((v, i) => (
              <div key={i} data-active={active === i} aria-hidden={active !== i} className="step-panel absolute inset-5">
                {v}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
