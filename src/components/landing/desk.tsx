"use client";

// The news-desk landing page: navigation, the hero demo and the "send it a link" tabs.

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Logo, PlatformGlyph } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#desk", label: "What's inside" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export function DeskNav({ loggedIn }: { loggedIn: boolean }) {
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);
  return (
    <header className="sticky top-0 z-40 bg-[var(--d-paper)]/90 backdrop-blur">
      <div className="mx-auto flex h-[72px] max-w-[1200px] items-center gap-8 px-4 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2" aria-label="PostFlow home">
          <span className="self-center"><Logo size={28} /></span>
          <span className="display text-[28px]">PostFlow</span>
        </Link>
        <nav aria-label="Sections" className="ml-auto hidden items-center gap-7 text-[16px] font-semibold lg:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="hover:text-[var(--d-red)]">{n.label}</a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 lg:ml-6">
          <ThemeToggle />
          <Link href={loggedIn ? "/calendar" : "/login"} className="btn-outline h-10 whitespace-nowrap px-3.5 sm:h-11 sm:px-[18px]">{loggedIn ? "Open app" : "Sign in"}</Link>
          <span className="lg:hidden">
            <button type="button" aria-expanded={menu} aria-controls="desk-menu" aria-label={menu ? "Close menu" : "Open menu"} onClick={() => setMenu((m) => !m)} className="inline-flex h-11 w-11 items-center justify-center rounded-lg">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                {menu ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
          </span>
        </div>
      </div>
      {menu && (
        <nav id="desk-menu" aria-label="Sections" className="border-t border-[var(--line)] px-4 pb-4 pt-2 lg:hidden">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} onClick={() => setMenu(false)} className="block py-3 text-[17px] font-semibold">{n.label}</a>
          ))}
        </nav>
      )}
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6"><div className="press-stripe" aria-hidden="true" /></div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// The logo card a post gets when it is about one named thing. These brands are made up for the demo.

function LogoCard({ name, color, mark, label }: { name: string; color: string; mark: ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 640 300" role="img" aria-label={label} className="block h-auto w-full border-t border-[var(--line)] bg-white">
      <rect width="640" height="300" fill="#ffffff" />
      <g transform="translate(176 118)">
        <g fill={color}>{mark}</g>
        <text x="84" y="48" fontFamily="Inter, system-ui, sans-serif" fontWeight="800" fontSize="44" letterSpacing="-1.5" fill="#18221e">{name}</text>
      </g>
    </svg>
  );
}

const PICTURES: Record<string, ReactNode> = {
  security: <LogoCard name="Pixelforge" color="#e8743b" label="Logo card: Pixelforge, a made-up image library" mark={<><rect x="0" y="4" width="28" height="28" rx="6" /><rect x="34" y="4" width="28" height="28" rx="6" opacity=".55" /><rect x="0" y="38" width="28" height="28" rx="6" opacity=".55" /><rect x="34" y="38" width="28" height="28" rx="6" /></>} />,
  ai: <LogoCard name="Lumen AI" color="#0e6b5b" label="Logo card: Lumen AI, a made-up AI company" mark={<><circle cx="32" cy="35" r="30" /><circle cx="32" cy="35" r="13" fill="#ffffff" /></>} />,
  web: <LogoCard name="Waypoint" color="#2f6fde" label="Logo card: Waypoint, a made-up web browser" mark={<path d="M32 2 L62 66 L32 50 L2 66 Z" />} />,
  saas: <LogoCard name="Paywell" color="#6b4fd8" label="Logo card: Paywell, a made-up payments company" mark={<><rect x="0" y="12" width="64" height="44" rx="10" /><rect x="0" y="24" width="64" height="9" fill="#ffffff" /></>} />,
};

const FIELDS = [
  { id: "security", label: "Security" },
  { id: "ai", label: "AI" },
  { id: "web", label: "Web dev" },
  { id: "saas", label: "Startups" },
] as const;
type Field = (typeof FIELDS)[number]["id"];

/** Made-up stories that show the shape of a post; they are labelled as samples on the page. */
const SAMPLES: Record<Field, { linkedin: string; x: string; tags: string }> = {
  security: {
    linkedin: "A bug in Pixelforge, a popular image library, lets a crafted picture run code on your server.\n\nIf your app resizes uploaded images, you are probably using it. The maintainers shipped a fix today, per the project's advisory. Update before you do anything else this week.",
    x: "A crafted image can run code on servers using Pixelforge, a popular image library. Fixed today, per the maintainers. If you resize uploads, update now.",
    tags: "#security #webdev",
  },
  ai: {
    linkedin: "Lumen AI just made its main model 80% cheaper.\n\nPer its announcement, the price cut applies to every plan. For a small SaaS, that is the difference between an AI feature you ration and one you can offer to everyone.",
    x: "Lumen AI cut its main model's price by 80%, per its announcement. AI features you rationed last month now fit on every plan.",
    tags: "#ai #saas",
  },
  web: {
    linkedin: "Slow pages lose visitors before your code even runs.\n\nThe Waypoint browser team says its new loading feature cuts first-load time by a third on typical sites. It is one line in your HTML, so it is worth a test on your heaviest page.",
    x: "Waypoint's new loading feature cuts first-load time by a third, per the browser team. One line of HTML. Worth a test today.",
    tags: "#webperf #frontend",
  },
  saas: {
    linkedin: "Paywell will stop charging small teams a monthly minimum.\n\nFor a SaaS with its first ten customers, that fee was often bigger than the revenue. Per the company, the change starts next month for new and existing accounts.",
    x: "No more monthly minimum for small teams on Paywell, per the company. For a SaaS with ten customers, that fee was often bigger than revenue.",
    tags: "#saas #startups",
  },
};

/** Pick a field and a platform, see the kind of post PostFlow writes, with the logo of what it is about. */
export function HeroDemo({ name = "Your Name" }: { name?: string }) {
  const [field, setField] = useState<Field>("security");
  const [platform, setPlatform] = useState<"linkedin" | "x">("linkedin");
  const s = SAMPLES[field];
  const text = platform === "x" ? `${s.x}\n\n${s.tags}` : s.linkedin;
  return (
    <div className="relative">
      {/* Pick a beat and a platform: newspaper section tabs, not a form. */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-[var(--ink)] pb-2">
        <div role="radiogroup" aria-label="News from" className="flex flex-wrap gap-x-4 gap-y-1">
          {FIELDS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={field === f.id} onClick={() => setField(f.id)} className={`typed py-1 text-[13px] uppercase tracking-[.1em] ${field === f.id ? "font-semibold text-[var(--ink)] underline decoration-[var(--mark)] decoration-[3px] underline-offset-[7px]" : "text-[var(--d-muted)] hover:text-[var(--ink)]"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Posted on" className="flex rounded-full border border-[var(--line-strong)] p-0.5">
          {(["linkedin", "x"] as const).map((pl) => (
            <button key={pl} type="button" role="radio" aria-checked={platform === pl} aria-label={pl === "x" ? "X" : "LinkedIn"} onClick={() => setPlatform(pl)} className={`flex h-8 w-11 items-center justify-center rounded-full ${platform === pl ? "bg-[var(--ink)] text-[var(--bg)]" : ""}`}>
              {pl === "x" ? <span className="text-[14px] font-bold">𝕏</span> : <span className="text-[13px] font-bold">in</span>}
            </button>
          ))}
        </div>
      </div>
      <article aria-live="polite" className="mt-6 -rotate-[0.6deg] overflow-hidden rounded-[4px] border border-[var(--line-strong)] bg-[var(--surface)] shadow-[0_18px_40px_-22px_rgba(24,34,30,.45)]">
        <div className="flex items-center gap-3 px-5 pt-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--d-cream)] text-[14px] font-bold" aria-hidden="true">{name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>
          <div className="min-w-0">
            <p className="text-[15px] font-bold">{name}</p>
            <p className="truncate text-[12px] text-[var(--d-muted)]">Software engineer · now</p>
          </div>
          <span className="ml-auto"><PlatformGlyph platform={platform} size={20} /></span>
        </div>
        <p className="whitespace-pre-line px-5 pb-4 pt-3 text-[15px] leading-relaxed">{text}</p>
        {PICTURES[field]}
      </article>
      <p className="typed mt-4 text-right text-[12px] text-[var(--d-muted)]">Sample post · made-up story and brand · pick a beat above</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Three ways a post starts.

const TABS = [
  {
    id: "news",
    label: "Today's news",
    title: ["The reading is our job.", "The byline is yours."],
    body: "PostFlow reads the news in your field all day, keeps the stories your audience will care about, and skips the version bumps.",
    you: null as string | null,
    bot: ["⏰ Going out in about 10 minutes", "LinkedIn · 09:15 · story from this morning, The Register"],
    draft: "A bug in Pixelforge, a popular image library, lets a crafted picture run code on your server. If your app resizes uploads, update this week.",
  },
  {
    id: "link",
    label: "Send it a link",
    title: ["Spotted something?", "Send the link."],
    body: "An article, an X post, a launch page. PostFlow reads it, the page it points to and what others wrote, and tells you straight if it isn't worth a post.",
    you: "x.com/someone/status/1981… this looks big",
    bot: ["🔎 Looked into it: 8/10", "A new speech model small enough for a laptop. Two outlets confirm it."],
    draft: "A speech model that listens and talks at the same time now fits on a laptop, per its launch page. Voice apps without a server bill just got real.",
  },
  {
    id: "lesson",
    label: "Teach something",
    title: ["Explain the news.", "In plain words."],
    body: "Once a day at most, a short lesson on the idea behind this week's story, so your feed teaches as well as reports.",
    you: "/learn supply-chain attacks",
    bot: ["🎓 Lesson ready", "For your 19:15 slot on LinkedIn"],
    draft: "One bad package can reach your app without you touching a line of code. That is a supply-chain attack: someone poisons a tool you trust, and every install carries it in.",
  },
] as const;

export function DeskTabs() {
  const [tab, setTab] = useState(0);
  const t = TABS[tab];
  return (
    <div>
      <div role="tablist" aria-label="Ways to start a post" className="flex flex-wrap gap-x-7 gap-y-2 border-b border-[var(--line)]">
        {TABS.map((x, i) => (
          <button
            key={x.id}
            role="tab"
            id={`tab-${x.id}`}
            aria-selected={tab === i}
            aria-controls={`panel-${x.id}`}
            onClick={() => setTab(i)}
            className={`-mb-px border-b-[3px] pb-3 text-[17px] font-semibold transition-colors ${tab === i ? "border-[var(--mark)] text-[var(--ink)]" : "border-transparent text-[var(--d-muted)] hover:text-[var(--ink)]"}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} className="grid gap-8 py-10 lg:grid-cols-2 lg:gap-14">
        <div>
          <h3 className="display text-[38px] sm:text-[46px]">
            {t.title[0]}
            <br />
            <span className="red">{t.title[1]}</span>
          </h3>
          <p className="mt-4 max-w-[460px] text-[18px] leading-relaxed text-[var(--d-muted)]">{t.body}</p>
          <p className="mt-10 hidden lg:block"><span className="stamp text-[22px]">Approved</span></p>
        </div>
        <div className="rounded-[6px] border border-[var(--line-strong)] bg-[var(--surface)] p-5 shadow-[0_18px_40px_-24px_rgba(24,34,30,.4)] sm:p-7">
          <div className="flex items-center justify-between border-b border-[var(--d-sky-line)] pb-4">
            <p className="text-[18px] font-bold">PostFlow bot</p>
            <p className="text-[13px] text-[var(--d-muted)]">Telegram · example</p>
          </div>
          {t.you && <p className="mt-5 ml-auto w-fit max-w-[90%] rounded-lg bg-[var(--d-sky)] px-4 py-3 text-[15px]">{t.you}</p>}
          <div className="mt-5 flex gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[var(--ink)] text-[15px] font-bold text-[var(--bg)]" aria-hidden="true">P</span>
            <div>
              <p className="text-[16px] font-bold">{t.bot[0]}</p>
              <p className="mt-0.5 text-[14px] text-[var(--d-muted)]">{t.bot[1]}</p>
            </div>
          </div>
          <div className="mt-5 border-t-2 border-[var(--mark)] pt-4">
            <p className="typed text-[12px] uppercase tracking-[.1em] text-[var(--d-muted)]">Draft</p>
            <p className="mt-2 text-[15px] leading-relaxed">{t.draft}</p>
          </div>
          <div className="mt-5 flex flex-wrap gap-2 text-[14px] font-semibold">
            <span className="rounded-md bg-[var(--d-ink)] px-3 py-2 text-[var(--d-paper)]">✅ Approve</span>
            <span className="rounded-md border border-[var(--d-sky-line)] px-3 py-2">✍️ New wording</span>
            <span className="rounded-md border border-[var(--d-sky-line)] px-3 py-2">🔁 Other story</span>
          </div>
        </div>
      </div>
    </div>
  );
}
