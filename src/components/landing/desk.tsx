"use client";

// The news-desk landing page: navigation, the hero demo and the "send it a link" tabs.

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Logo, PlatformGlyph } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#desk", label: "What's inside" },
  { href: "#pricing", label: "Fair pricing" },
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
          <span className="typed red hidden text-[14px] sm:inline">news desk</span>
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
// Pictures in the house style: one or two simple objects, one accent colour, no words.

function Frame({ bg, children, label }: { bg: [string, string]; children: ReactNode; label: string }) {
  const id = `g${bg[0].slice(1)}`;
  return (
    <svg viewBox="0 0 640 300" role="img" aria-label={label} className="block h-auto w-full">
      <defs>
        <radialGradient id={id} cx="50%" cy="35%" r="80%">
          <stop offset="0%" stopColor={bg[0]} />
          <stop offset="100%" stopColor={bg[1]} />
        </radialGradient>
        <filter id={`${id}s`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="12" stdDeviation="12" floodColor="#1d2b3a" floodOpacity=".25" />
        </filter>
      </defs>
      <rect width="640" height="300" fill={`url(#${id})`} />
      <ellipse cx="320" cy="268" rx="160" ry="13" fill="#1d2b3a" opacity=".14" />
      <g filter={`url(#${id}s)`}>{children}</g>
    </svg>
  );
}

const PICTURES: Record<string, ReactNode> = {
  security: (
    <Frame bg={["#e2eaee", "#b7c6cd"]} label="Illustration: a huge vault door held shut by one small orange paper clip">
      <circle cx="320" cy="150" r="112" fill="#e9eef0" stroke="#9fadb3" strokeWidth="5" />
      <circle cx="320" cy="150" r="88" fill="none" stroke="#9fadb3" strokeWidth="5" opacity=".7" />
      <circle cx="320" cy="150" r="26" fill="#dfe5e8" stroke="#9fadb3" strokeWidth="5" />
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <rect key={a} x="316" y="80" width="8" height="46" rx="4" fill="#9fadb3" transform={`rotate(${a} 320 150)`} />
      ))}
      <path d="M432 100 v100" stroke="#8e9ca3" strokeWidth="4" strokeLinecap="round" />
      <g transform="translate(414 138) rotate(-8)">
        <path d="M8 0 h40 a14 14 0 0 1 0 28 h-36 a9 9 0 0 1 0 -18 h30" fill="none" stroke="#e8743b" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </Frame>
  ),
  ai: (
    <Frame bg={["#efe7da", "#d5c6ae"]} label="Illustration: a large price tag with a pair of orange scissors cutting it in half">
      <g transform="rotate(-10 320 150)">
        <path d="M230 90 h170 l50 60 l-50 60 h-170 a14 14 0 0 1 -14 -14 v-92 a14 14 0 0 1 14 -14 Z" fill="#fbf6ee" stroke="#b8a58a" strokeWidth="5" />
        <circle cx="400" cy="150" r="11" fill="none" stroke="#b8a58a" strokeWidth="5" />
        <path d="M318 84 l-8 132" stroke="#b8a58a" strokeWidth="3" strokeDasharray="8 8" />
      </g>
      <g transform="translate(250 200) rotate(-35)">
        <circle cx="0" cy="0" r="16" fill="none" stroke="#e8743b" strokeWidth="8" />
        <circle cx="0" cy="44" r="16" fill="none" stroke="#e8743b" strokeWidth="8" />
        <path d="M12 10 L90 34 M12 34 L90 10" stroke="#e8743b" strokeWidth="8" strokeLinecap="round" />
      </g>
    </Frame>
  ),
  web: (
    <Frame bg={["#e3ecf9", "#b9cbe6"]} label="Illustration: a tall hourglass with almost all the sand still at the top, and a small orange lightning bolt beside it">
      <rect x="262" y="40" width="116" height="16" rx="8" fill="#8fa3c2" />
      <rect x="262" y="246" width="116" height="16" rx="8" fill="#8fa3c2" />
      <path d="M276 56 h88 c0 50 -40 70 -44 95 c4 25 44 45 44 95 h-88 c0 -50 40 -70 44 -95 c-4 -25 -44 -45 -44 -95 Z" fill="#f4f7fc" stroke="#8fa3c2" strokeWidth="5" />
      <path d="M284 70 h72 c-4 30 -30 50 -36 66 c-6 -16 -32 -36 -36 -66 Z" fill="#d9c7a0" />
      <path d="M314 238 h12 l-6 -8 Z" fill="#d9c7a0" />
      <path d="M430 110 l-26 52 h22 l-14 48 l40 -62 h-24 l16 -38 Z" fill="#e8743b" />
    </Frame>
  ),
  saas: (
    <Frame bg={["#e4efe6", "#bcd2c1"]} label="Illustration: a small green seedling growing out of a neat stack of coins, with one orange coin on top">
      {[0, 1, 2, 3].map((i) => (
        <ellipse key={i} cx="320" cy={236 - i * 22} rx="70" ry="18" fill="#f1ede2" stroke="#a9b8a6" strokeWidth="5" />
      ))}
      <ellipse cx="320" cy="148" rx="70" ry="18" fill="#e8743b" />
      <path d="M320 140 c0 -30 0 -50 4 -70" stroke="#5f8a62" strokeWidth="7" fill="none" strokeLinecap="round" />
      <path d="M324 92 c20 -24 50 -22 60 -16 c-10 20 -40 30 -60 16 Z" fill="#7fae80" />
      <path d="M322 110 c-18 -20 -46 -18 -54 -12 c10 18 36 26 54 12 Z" fill="#7fae80" />
    </Frame>
  ),
};

const FIELDS = [
  { id: "security", label: "Security" },
  { id: "ai", label: "AI & machine learning" },
  { id: "web", label: "Web development" },
  { id: "saas", label: "SaaS & startups" },
] as const;
type Field = (typeof FIELDS)[number]["id"];

/** Made-up stories that show the shape of a post; they are labelled as samples on the page. */
const SAMPLES: Record<Field, { linkedin: string; x: string; tags: string }> = {
  security: {
    linkedin: "A bug in a popular image library lets a crafted picture run code on your server.\n\nIf your app resizes uploaded images, you are probably using it. The maintainers shipped a fix today, per the project's advisory. Update before you do anything else this week.",
    x: "A crafted image can run code on servers using a popular image library. Fixed today, per the maintainers. If you resize uploads, update now.",
    tags: "#security #webdev",
  },
  ai: {
    linkedin: "Running a large AI model just got 80% cheaper.\n\nThe provider cut prices on its main model, per its announcement. For a small SaaS, that is the difference between an AI feature you ration and one you can offer on every plan.",
    x: "Large AI model prices just fell 80%, per the provider. AI features you rationed last month now fit on every plan.",
    tags: "#ai #saas",
  },
  web: {
    linkedin: "Slow pages lose visitors before your code even runs.\n\nA browser team says its new loading feature cuts first-load time by a third on typical sites. It is one line in your HTML, so it is worth a test on your heaviest page.",
    x: "A new browser loading feature cuts first-load time by a third, per the team behind it. One line of HTML. Worth a test today.",
    tags: "#webperf #frontend",
  },
  saas: {
    linkedin: "A payments provider will stop charging small teams a monthly minimum.\n\nFor a SaaS with its first ten customers, that fee was often bigger than the revenue. Per the company, the change starts next month for new and existing accounts.",
    x: "No more monthly minimum for small teams, per the payments provider. For a SaaS with ten customers, that fee was often bigger than revenue.",
    tags: "#saas #startups",
  },
};

/** Pick a field and a platform, see the kind of post PostFlow writes, with its picture. */
export function HeroDemo({ name = "Your Name" }: { name?: string }) {
  const [field, setField] = useState<Field>("security");
  const [platform, setPlatform] = useState<"linkedin" | "x">("linkedin");
  const s = SAMPLES[field];
  const text = platform === "x" ? `${s.x}\n\n${s.tags}` : s.linkedin;
  return (
    <div className="rounded-2xl border-[1.5px] border-[var(--d-sky-line)] bg-[var(--d-sky)] p-5 sm:p-7">
      <p className="flex items-center gap-2 text-[16px] font-bold">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--d-red)]" aria-hidden="true" /> Your next post
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-[14px] font-semibold text-[var(--d-muted)]">
          News from
          <select value={field} onChange={(e) => setField(e.target.value as Field)} className="mt-1.5 block h-12 w-full rounded-lg border-[1.5px] border-[var(--d-sky-line)] bg-[var(--surface)] px-3 text-[15px] font-semibold text-[var(--d-ink)]">
            {FIELDS.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-[14px] font-semibold text-[var(--d-muted)]">
          Posted on
          <select value={platform} onChange={(e) => setPlatform(e.target.value as "linkedin" | "x")} className="mt-1.5 block h-12 w-full rounded-lg border-[1.5px] border-[var(--d-sky-line)] bg-[var(--surface)] px-3 text-[15px] font-semibold text-[var(--d-ink)]">
            <option value="linkedin">LinkedIn</option>
            <option value="x">X</option>
          </select>
        </label>
      </div>
      <article aria-live="polite" className="mt-5 overflow-hidden rounded-xl border border-[var(--d-sky-line)] bg-[var(--surface)] shadow-[0_6px_0_var(--d-sky-line)]">
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
      <div className="mt-4 flex items-end justify-between gap-4">
        <p className="text-[14px] leading-snug">
          Change the field.
          <br />
          <strong>The news is yours to pick.</strong>
        </p>
        <p className="typed text-right text-[12px] text-[var(--d-muted)]">Sample post · made-up story</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Send it a link. Keep the final say."

const TABS = [
  {
    id: "news",
    label: "Today's news",
    title: ["The reading is our job.", "The byline is yours."],
    body: "PostFlow reads the news in your field all day, keeps the stories your audience will care about, and skips the version bumps.",
    you: null as string | null,
    bot: ["⏰ Going out in about 10 minutes", "LinkedIn · 09:15 · story from this morning, The Register"],
    draft: "A bug in a popular image library lets a crafted picture run code on your server. If your app resizes uploads, update this week.",
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
      <div role="tablist" aria-label="Ways to start a post" className="flex flex-wrap gap-2.5">
        {TABS.map((x, i) => (
          <button
            key={x.id}
            role="tab"
            id={`tab-${x.id}`}
            aria-selected={tab === i}
            aria-controls={`panel-${x.id}`}
            onClick={() => setTab(i)}
            className={`h-12 rounded-lg border-[1.5px] px-5 text-[16px] font-bold transition-colors ${tab === i ? "border-[var(--d-ink)] bg-[var(--d-ink)] text-[var(--d-paper)]" : "border-[var(--d-sky-line)] hover:border-[var(--d-ink)]"}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} className="mt-0 grid gap-8 border-t-2 border-[var(--d-ink)] bg-[var(--d-sky)] px-5 py-10 sm:px-12 lg:grid-cols-2 lg:gap-14">
        <div>
          <h3 className="display text-[38px] sm:text-[46px]">
            {t.title[0]}
            <br />
            {t.title[1]}
          </h3>
          <p className="mt-4 max-w-[460px] text-[18px] leading-relaxed text-[var(--d-muted)]">{t.body}</p>
          <p className="mt-10 hidden lg:block"><span className="stamp text-[22px]">Approved</span></p>
        </div>
        <div className="rounded-xl border-[1.5px] border-[var(--d-sky-line)] bg-[var(--surface)] p-5 shadow-[0_6px_0_var(--d-sky-line)] sm:p-7">
          <div className="flex items-center justify-between border-b border-[var(--d-sky-line)] pb-4">
            <p className="text-[18px] font-bold">PostFlow bot</p>
            <p className="text-[13px] text-[var(--d-muted)]">Telegram · example</p>
          </div>
          {t.you && <p className="mt-5 ml-auto w-fit max-w-[90%] rounded-lg bg-[var(--d-sky)] px-4 py-3 text-[15px]">{t.you}</p>}
          <div className="mt-5 flex gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-[var(--d-red)] text-[15px] font-bold text-white" aria-hidden="true">P</span>
            <div>
              <p className="text-[16px] font-bold">{t.bot[0]}</p>
              <p className="mt-0.5 text-[14px] text-[var(--d-muted)]">{t.bot[1]}</p>
            </div>
          </div>
          <div className="mt-5 border-t-[3px] border-[var(--d-red)] pt-4">
            <p className="typed text-[12px] uppercase tracking-[.1em] text-[var(--d-muted)]">Draft</p>
            <p className="mt-2 text-[15px] leading-relaxed">{t.draft}</p>
          </div>
          <div className="mt-5 flex flex-wrap gap-2 text-[14px] font-semibold">
            <span className="rounded-md bg-[var(--d-ink)] px-3 py-2 text-[var(--d-paper)]">✅ Approve</span>
            <span className="rounded-md border border-[var(--d-sky-line)] px-3 py-2">✍️ New wording</span>
            <span className="rounded-md border border-[var(--d-sky-line)] px-3 py-2">🎨 New picture</span>
          </div>
        </div>
      </div>
    </div>
  );
}
