"use client";

// The news-desk landing page: navigation, the hero demo and the "send it a link" tabs.

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Logo, PlatformGlyph } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV = [
  { href: "#watch", label: "Watch it work" },
  { href: "#who", label: "Who it's for" },
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
        <text x="84" y="48" fontFamily="Inter, system-ui, sans-serif" fontWeight="600" fontSize="44" letterSpacing="-1" fill="#18221e">{name}</text>
      </g>
    </svg>
  );
}

const PICTURES: Record<string, ReactNode> = {
  security: <LogoCard name="Pixelforge" color="#e8743b" label="Logo card: Pixelforge, a made-up image library" mark={<><rect x="0" y="4" width="28" height="28" rx="6" /><rect x="34" y="4" width="28" height="28" rx="6" opacity=".55" /><rect x="0" y="38" width="28" height="28" rx="6" opacity=".55" /><rect x="34" y="38" width="28" height="28" rx="6" /></>} />,
  ai: <LogoCard name="Lumen AI" color="#0e6b5b" label="Logo card: Lumen AI, a made-up AI company" mark={<><circle cx="32" cy="35" r="30" /><circle cx="32" cy="35" r="13" fill="#ffffff" /></>} />,
};

const FIELDS = [
  { id: "security", label: "Tech", role: "Software engineer", name: "Sam Carter" },
  { id: "ai", label: "AI", role: "Startup founder", name: "Lena Brooks" },
  { id: "health", label: "Healthcare", role: "Eye doctor", name: "Dr. Asha Rana" },
  { id: "tax", label: "Accounting", role: "Chartered accountant", name: "Tom Hale" },
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
  health: {
    linkedin: "Children should now have their first eye check at three, not five.\n\nThe Eye Health Council changed its screening advice this week, saying lazy eye responds best to treatment when it is caught young. For parents of toddlers, that moves the first check two years earlier.\n\nGeneral information, not medical advice.",
    x: "First eye check for children moves from age five to three, per the Eye Health Council. Lazy eye responds best when caught young. General information, not medical advice.",
    tags: "#eyehealth #paediatrics",
  },
  tax: {
    linkedin: "UK small businesses can now earn up to £90,000 a year before they must register for VAT.\n\nThe threshold rose from £85,000 on 1 April 2024, HMRC says, the first rise since 2017. For a sole trader near the old limit, that is room to grow without adding VAT to every invoice.",
    x: "UK VAT registration threshold: now £90,000, up from £85,000 since 1 April 2024, per HMRC. First rise since 2017.",
    tags: "#UKtax #smallbusiness",
  },

};

/** Pick a field and a platform, see the kind of post PostFlow writes, with the logo of what it is about. */
export function HeroDemo() {
  const [field, setField] = useState<Field>("security");
  const [platform, setPlatform] = useState<"linkedin" | "x">("linkedin");
  const s = SAMPLES[field];
  const who = FIELDS.find((f) => f.id === field)!;
  const initials = who.name.replace("Dr. ", "").split(" ").map((w) => w[0]).join("").slice(0, 2);
  const text = platform === "x" ? `${s.x}\n\n${s.tags}` : s.linkedin;
  return (
    <div className="relative">
      {/* Pick a beat and a platform: newspaper section tabs, not a form. */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-[var(--ink)] pb-2">
        <div role="radiogroup" aria-label="News from" className="flex flex-wrap gap-x-4 gap-y-1">
          {FIELDS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={field === f.id} onClick={() => setField(f.id)} className={`typed py-1 text-[13px] ${field === f.id ? "font-semibold text-[var(--ink)] underline decoration-[var(--mark)] decoration-[3px] underline-offset-[7px]" : "text-[var(--d-muted)] hover:text-[var(--ink)]"}`}>
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
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--d-cream)] text-[14px] font-semibold" aria-hidden="true">{initials}</span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">{who.name}</p>
            <p className="truncate text-[13px] text-[var(--d-muted)]">{who.role} · now</p>
          </div>
          <span className="ml-auto"><PlatformGlyph platform={platform} size={20} /></span>
        </div>
        <p className="whitespace-pre-line px-5 pb-4 pt-3 text-[15px] leading-relaxed">{text}</p>
        {PICTURES[field] ?? null}
      </article>
      <p className="typed mt-4 text-right text-[13px] text-[var(--d-muted)]">Sample posts for illustration · pick a beat above</p>
    </div>
  );
}
