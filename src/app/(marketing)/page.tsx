import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { isLoggedIn } from "@/server/auth";
import { signupsOpen } from "@/server/users";
import { Logo } from "@/components/ui";
import { Pricing } from "@/components/landing/pricing";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { LandingMotion } from "@/components/landing/motion";
import { DeskNav, DeskTabs, HeroDemo } from "@/components/landing/desk";
import { BETA, TRIAL_DAYS } from "@/lib/pricing";
import { env } from "@/server/env";

const TITLE = "PostFlow · The news breaks. Your post is ready.";
const DESCRIPTION =
  "PostFlow reads the news in your field, writes a clear LinkedIn or X post, checks every fact, and waits for your one-tap OK on Telegram.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "PostFlow",
    title: "PostFlow · The news breaks. Your post is ready.",
    description: DESCRIPTION,
    images: [{ url: "/landing/calendar-light.png", width: 2560, height: 1600, alt: "The PostFlow calendar with a week of LinkedIn and X posts" }],
  },
  twitter: { card: "summary_large_image", title: "PostFlow · The news breaks. Your post is ready.", description: DESCRIPTION, images: ["/landing/calendar-light.png"] },
};

const faqFor = (beta: boolean): { q: string; a: string }[] => [
  {
    q: "Will it post something I haven't seen?",
    a: "Not unless you choose that. Ten minutes before each post, Telegram sends it to you. If you don't approve it, it is skipped and the calendar moves on. On Pro you can switch to auto mode later.",
  },
  {
    q: "Does it make things up?",
    a: "It is built not to. Every news post names its source, and a separate reviewer checks each claim against the article before it reaches you. Stories are only used once other publishers confirm them. First-person stories only come from notes you wrote.",
  },
  {
    q: "Do posts come with a picture?",
    a: "When a post is about one named company or product, it gets that company's official logo from Wikimedia Commons, so people see at a glance what it is about. Posts about a general idea go out as text only, which is how most good posts look anyway. You can switch logos off per post or per platform.",
  },
  {
    q: "Is it only for software engineers?",
    a: "No. When you sign up you pick your field: software and tech, healthcare, finance and accounting, law, marketing, education or something else, plus the topics you know best. The news, what counts as important, and the rules each post follows all change with it. A doctor's posts never give medical advice, and an accountant's always say which country a tax rule is from.",
  },
  {
    q: "What do I need to connect?",
    a: `${beta ? "Your LinkedIn profile (X comes with Pro)" : "Your LinkedIn profile and your X account"}, through their official sign-in pages. PostFlow never sees your passwords. Telegram is optional and free: it's the fastest way to approve posts and send links from your phone.`,
  },
  beta
    ? {
        q: "Is it really free?",
        a: `Yes, on LinkedIn, while PostFlow is in beta: up to ${BETA.quota.postsPerMonth} posts a month, with no card. Posting to X comes with the Pro plan, because X charges for every post. Pro opens soon; join the waitlist and you will hear first.`,
      }
    : {
        q: "Why is there no free plan?",
        a: `Every post costs real money to make: several AI calls to write, check and draw it, and X charges per post. A free plan would mean cutting the fact-checking. Every plan starts with a ${TRIAL_DAYS}-day free trial instead.`,
      },
  {
    q: "Can I cancel?",
    a: "Anytime, from your account. Disconnecting an account in Settings stops all posting to it immediately.",
  },
];

/** Two-line headline: navy first line, red second line. */
function Headline({ a, b, as: Tag = "h2", className = "" }: { a: ReactNode; b: ReactNode; as?: "h1" | "h2"; className?: string }) {
  return (
    <Tag className={`display ${className}`}>
      {a}
      <br />
      <span className="red">{b}</span>
    </Tag>
  );
}

function Rule() {
  return <hr className="mx-auto max-w-[1200px] border-[var(--d-sky-line)]" />;
}

const DESK = [
  { t: "News desk", b: "Reads your field all day. Keeps what your audience will care about." },
  { t: "Research", b: "Digs into any link, even an X post, before a word is written." },
  { t: "Fact-checker", b: "Every claim checked against the source. Weak drafts never reach you." },
  { t: "Logo desk", b: "A story about Qwen gets the Qwen logo. A general idea stays text only." },
  { t: "Telegram", b: "Each post arrives ten minutes early. One tap to approve." },
  { t: "Calendar", b: "Two posts a day, and never the same story twice." },
];

export default async function LandingPage({ searchParams }: { searchParams: Promise<{ plan?: string; deleted?: string }> }) {
  const { plan, deleted } = await searchParams;
  const loggedIn = await isLoggedIn().catch(() => false);
  const open = signupsOpen();
  const beta = env().FREE_BETA;
  const FAQ = faqFor(beta);
  const startLabel = beta ? "Join the free beta" : `Start my ${TRIAL_DAYS}-day trial`;
  const cta = open ? { href: "/signup?plan=pro&interval=year", label: startLabel } : { href: "#early-access", label: "Get early access" };

  return (
    <div className="desk min-h-screen text-[16px]">
      <a href="#main" className="skip-link">Skip to content</a>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
          }).replace(/</g, "\\u003c"),
        }}
      />
      <LandingMotion />
      <DeskNav loggedIn={loggedIn} />

      <main id="main" tabIndex={-1} className="outline-none">
        {deleted && <p role="status" className="mx-auto mt-4 max-w-[1200px] px-4 text-[14px]">Your account and its data were deleted, and your subscription was cancelled.</p>}

        {/* ---------- hero ---------- */}
        <section className="mx-auto grid max-w-[1200px] gap-12 px-4 pb-20 pt-12 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pt-16">
          <div>
            <Headline
              as="h1"
              a="The news breaks."
              b="Your post is ready."
              className="text-[50px] sm:text-[72px] xl:text-[80px]"
            />
            <p className="mt-7 max-w-[560px] text-[19px] leading-[1.7] text-[var(--d-muted)] sm:text-[21px]">
              PostFlow reads <span className="hl">the news in your field</span>, writes <span className="hl">a clear post anyone can follow</span> and checks every fact. Ten minutes before it goes out, Telegram asks for your OK.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a href={cta.href} className="btn-desk">{cta.label}</a>
              <a href="#how" className="btn-outline">See how it works</a>
            </div>
            <p className="mt-3 text-[14px] text-[var(--d-muted)]">{beta ? "Free on LinkedIn during the beta. No card needed." : open ? "No charge during the trial. Cancel anytime." : `${TRIAL_DAYS}-day free trial at launch. No card to join.`}</p>
            {/* A byline strip: what every post comes with. */}
            <p className="typed mt-10 flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-[var(--line)] py-3 text-[13px] uppercase tracking-[.12em] text-[var(--d-muted)]">
              <span>Fact-checked</span><span aria-hidden="true">·</span><span>Plain words</span><span aria-hidden="true">·</span><span>Sent only when you approve</span>
            </p>
          </div>
          <HeroDemo />
        </section>

        <Rule />

        {/* ---------- how it works ---------- */}
        <section id="how" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 py-20 sm:px-6 sm:py-24">
          <div className="mb-10 grid gap-6 lg:grid-cols-2 lg:items-end">
            <Headline a="Bring a link, or nothing." b="It does the reading." className="text-[46px] sm:text-[68px]" />
            <p className="max-w-[520px] text-[19px] leading-relaxed text-[var(--d-muted)] lg:justify-self-end">
              A story you spotted, a launch you shipped, a lesson worth sharing. Start with whatever you have, or let the desk find the news.
            </p>
          </div>
          <DeskTabs />
        </section>

        <Rule />

        {/* ---------- what's inside ---------- */}
        <section id="desk" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 py-20 sm:px-6 sm:py-24">
          <div className="mb-12 grid gap-6 lg:grid-cols-2 lg:items-end">
            <Headline a="The whole newsroom." b="In one quiet tab." className="text-[46px] sm:text-[68px]" />
            <p className="max-w-[520px] text-[19px] leading-relaxed text-[var(--d-muted)] lg:justify-self-end">You need more than a text box. So does your audience.</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {DESK.map((d, i) => (
              <div key={d.t} className="card-lift reveal p-7" style={{ "--d": `${(i % 3) * 80}ms` } as React.CSSProperties}>
                <div className="flex items-center justify-between">
                  <span className="typed pt-3 text-[13px] uppercase tracking-[.14em] text-[var(--d-muted)]">No. {i + 1}</span>
                </div>
                <h3 className="display mt-5 text-[28px] tracking-[-0.03em]">{d.t}</h3>
                <p className="mt-2 text-[16px] leading-relaxed text-[var(--d-muted)]">{d.b}</p>
              </div>
            ))}
          </div>
        </section>

        <Rule />

        {/* ---------- pricing ---------- */}
        <section id="pricing" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 py-20 sm:px-6 sm:py-24">
          <div className="mb-12 grid gap-6 lg:grid-cols-2 lg:items-end">
            <div>
              <Headline a="One price a month." b="Every post checked." className="text-[46px] sm:text-[68px]" />
            </div>
            <p className="max-w-[520px] text-[19px] leading-relaxed text-[var(--d-muted)] lg:justify-self-end">
              {beta
                ? "LinkedIn is free while PostFlow is in beta. Pro adds X and opens soon. Every plan includes the fact-checker."
                : `Every plan includes the fact-checker. No free plan, because checking costs real money. A ${TRIAL_DAYS}-day trial instead.`}
            </p>
          </div>
          <Pricing signupsOpen={open} beta={beta} />
        </section>

        <Rule />

        {/* ---------- FAQ ---------- */}
        <section id="faq" className="mx-auto grid max-w-[1200px] scroll-mt-24 gap-10 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[0.8fr_1.2fr]">
          <Headline a="Before you" b="sign up." className="text-[46px] sm:text-[60px]" />
          <div className="divide-y divide-[var(--d-sky-line)] border-y border-[var(--d-sky-line)]">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[18px] font-bold [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span aria-hidden="true" className="red flex-none text-[26px] leading-none transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 max-w-[640px] text-[16px] leading-relaxed text-[var(--d-muted)]">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ---------- last call ---------- */}
        <section id="early-access" className="scroll-mt-24 bg-[var(--d-sky)]">
          <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-2">
            <div>
              <Headline a="Your next post" b="is already in the news." className="text-[44px] sm:text-[64px]" />
              <p className="mt-6 max-w-[500px] text-[19px] leading-relaxed text-[var(--d-muted)]">
                {open && beta && plan
                  ? `The ${plan === "agency" ? "Agency" : "Pro"} plan adds X and opens soon. Join the list and you will hear first. Until then, LinkedIn is free.`
                  : open
                  ? beta
                    ? "Connect LinkedIn, pick your field, and your first posts arrive in Telegram today. Free during the beta."
                    : `Connect LinkedIn or X, pick your field, and your first posts arrive in Telegram today. ${TRIAL_DAYS} days free.`
                  : `PostFlow is opening to a small group first. Join the list for an invite${beta ? " to the free beta." : ` and a ${TRIAL_DAYS}-day free trial.`}`}
              </p>
            </div>
            {open && plan !== "agency" && !(beta && plan) ? (
              <div className="rounded-2xl border-[1.5px] border-[var(--d-sky-line)] bg-[var(--surface)] p-8 shadow-[0_6px_0_var(--d-sky-line)]">
                <a href="/signup?plan=pro&interval=year" className="btn-desk w-full">{startLabel}</a>
                <p className="mt-4 text-center text-[15px] text-[var(--d-muted)]">
                  Already on the desk? <Link href="/login" className="font-semibold underline">Sign in</Link>
                </p>
              </div>
            ) : (
              <WaitlistForm plan={plan} />
            )}
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-[1200px] px-4 pb-10 sm:px-6">
        <div className="press-stripe mb-8" aria-hidden="true" />
        <div className="flex flex-col gap-5 text-[15px] text-[var(--d-muted)] sm:flex-row sm:items-center">
          <span className="flex items-center gap-2 text-[var(--d-ink)]">
            <Logo size={22} />
            <span className="display text-[22px]">PostFlow</span>
          </span>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            <a href="#how" className="hover:text-[var(--d-ink)]">How it works</a>
            <a href="#pricing" className="hover:text-[var(--d-ink)]">Pricing</a>
            <a href="#faq" className="hover:text-[var(--d-ink)]">FAQ</a>
            <Link href="/terms" className="hover:text-[var(--d-ink)]">Terms</Link>
            <Link href="/privacy" className="hover:text-[var(--d-ink)]">Privacy</Link>
          </nav>
          <p className="sm:ml-auto">© {new Date().getFullYear()} PostFlow</p>
        </div>
      </footer>
    </div>
  );
}
