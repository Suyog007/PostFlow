import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { isLoggedIn } from "@/server/auth";
import { signupsOpen } from "@/server/users";
import { Logo } from "@/components/ui";
import { Pricing } from "@/components/landing/pricing";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { LandingMotion } from "@/components/landing/motion";
import { DeskNav, HeroDemo } from "@/components/landing/desk";
import { NewsFilm } from "@/components/landing/film";
import { BETA, TRIAL_DAYS } from "@/lib/pricing";
import { env } from "@/server/env";

const TITLE = "PostFlow · The news breaks. Your post is ready.";
const DESCRIPTION =
  "PostFlow reads the news in your field, drafts a short LinkedIn post that names its source, and waits for your OK before it goes out.";

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
    a: "No, unless you turn on auto mode. Every post waits for your OK on the calendar; one you don't approve is skipped.",
  },
  {
    q: "Do I need Telegram?",
    a: "No. It's optional: it sends each post to your phone ten minutes early, so approving takes one tap.",
  },
  {
    q: "Does it make things up?",
    a: "It's built not to. News posts name their source, each claim is checked against the article, and first-person posts only come from your own notes. It can still get something wrong, which is why you approve first.",
  },
  {
    q: "Do posts come with a picture?",
    a: "Only when a post is about one named company or product: it gets that company's logo from Wikimedia Commons. Everything else is text.",
  },
  {
    q: "What do I connect?",
    a: `${beta ? "Your LinkedIn profile (X comes with Pro)" : "Your LinkedIn profile and your X account"}, through their own sign-in pages. PostFlow never sees your password.`,
  },
  beta
    ? {
        q: "Is it really free?",
        a: `Yes, on LinkedIn during the beta: up to ${BETA.quota.postsPerMonth} posts a month, no card. X costs money per post, so it comes with Pro.`,
      }
    : {
        q: "Why is there no free plan?",
        a: `Every post costs real money to write and check, and X charges per post. Every plan starts with a ${TRIAL_DAYS}-day free trial instead.`,
      },
  {
    q: "Can I cancel?",
    a: "Anytime, from your account. Disconnecting LinkedIn or X stops all posting to it at once.",
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

/** One line per profession: what PostFlow watches for them, and the rule their posts follow. */
const PROFESSIONS = [
  { who: "Software engineers", watch: "Launches, security alerts and AI news in your stack.", rule: "Explains every acronym." },
  { who: "Doctors & clinicians", watch: "Guideline changes, recalls and strong new studies in your speciality.", rule: "Never gives medical advice." },
  { who: "Accountants & finance", watch: "Tax changes, filing deadlines and new reporting standards.", rule: "Always names the country." },
  { who: "Lawyers & compliance", watch: "New laws, rulings and compliance deadlines in your area.", rule: "Always names the jurisdiction." },
  { who: "Marketers & sales", watch: "Platform, algorithm and privacy changes that move your numbers.", rule: "Never invents results." },
  { who: "Teachers & educators", watch: "Exam, curriculum and policy changes, and what the evidence says.", rule: "Never names a student." },
];

const DESK = [
  { t: "Sources named", b: "Every news post says where the story came from, and a story is only used once a second outlet or the company itself confirms it." },
  { t: "Checked twice", b: "A reviewer compares each claim with the article, then a second model reads it again. Drafts that fail are held back." },
  { t: "From a link", b: "Send a link or an X post and it reads the whole thing before writing." },
  { t: "One story, once", b: "Posts land on your schedule, and the same story is never posted twice." },
];

export default async function LandingPage({ searchParams }: { searchParams: Promise<{ plan?: string; deleted?: string }> }) {
  const { plan, deleted } = await searchParams;
  const loggedIn = await isLoggedIn().catch(() => false);
  const open = signupsOpen();
  const beta = env().FREE_BETA;
  const FAQ = faqFor(beta);
  const startLabel = beta ? "Join the free beta" : `Start my ${TRIAL_DAYS}-day trial`;
  const signupHref = beta ? "/signup" : "/signup?plan=pro&interval=year";
  const cta = open ? { href: signupHref, label: startLabel } : { href: "#early-access", label: "Get early access" };

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
              PostFlow reads <span className="hl">the news in your field</span> and drafts a short post about the stories worth sharing. Each one names its source, and nothing goes out until <span className="hl">you approve it</span>.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a href={cta.href} className="btn-desk">{cta.label}</a>
              <a href="#watch" className="btn-outline">See how it works</a>
            </div>
            <p className="mt-3 text-[14px] text-[var(--d-muted)]">{beta ? "Free on LinkedIn during the beta. No card needed." : open ? "No charge during the trial. Cancel anytime." : `${TRIAL_DAYS}-day free trial at launch. No card to join.`}</p>
            {/* A byline strip: what every post comes with. */}
            <p className="typed mt-10 flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-[var(--line)] py-3 text-[13px] uppercase tracking-[.12em] text-[var(--d-muted)]">
              <span>Names its source</span><span aria-hidden="true">·</span><span>Plain words</span><span aria-hidden="true">·</span><span>You approve first</span>
            </p>
          </div>
          <HeroDemo />
        </section>

        <Rule />

        {/* ---------- a real post ---------- */}
        <section id="real" className="mx-auto grid max-w-[1200px] scroll-mt-24 items-center gap-10 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div>
            <Headline a="One real post." b="Drafted by PostFlow." className="text-[46px] sm:text-[60px]" />
            <p className="mt-6 max-w-[480px] text-[19px] leading-relaxed text-[var(--d-muted)]">
              PostFlow found this story in its owner's feeds, wrote the post, checked it against the article and waited for approval. It reached 263 impressions in its first 11 minutes.
            </p>
            <p className="typed mt-5 text-[13px] uppercase tracking-[.12em] text-[var(--d-muted)]">Published on LinkedIn · name and photo changed for privacy</p>
          </div>
          <figure className="reveal overflow-hidden rounded-[6px] border border-[var(--line-strong)] bg-white shadow-[0_18px_40px_-22px_rgba(24,34,30,.45)]">
            <img
              src="/landing/real-post.webp"
              width={880}
              height={673}
              loading="lazy"
              decoding="async"
              alt="A LinkedIn post drafted by PostFlow about Meta's Muse Ember model, with 263 impressions after 11 minutes. The author's name and photo are replaced with a placeholder."
              className="block h-auto w-full"
            />
          </figure>
        </section>

        <Rule />

        {/* ---------- watch it work ---------- */}
        <section id="watch" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 py-20 sm:px-6 sm:py-24">
          <div className="mb-10 grid gap-6 lg:grid-cols-2 lg:items-end">
            <Headline a="Watch it work." b="In thirty seconds." className="text-[46px] sm:text-[68px]" />
            <p className="max-w-[520px] text-[19px] leading-relaxed text-[var(--d-muted)] lg:justify-self-end">
              From a story breaking to a post your readers see, without you writing a word. You only tap approve.
            </p>
          </div>
          <NewsFilm />
        </section>

        <Rule />

        {/* ---------- who it's for ---------- */}
        <section id="who" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 py-20 sm:px-6 sm:py-24">
          <div className="mb-12 grid gap-6 lg:grid-cols-2 lg:items-end">
            <Headline a="Pick your field." b="Get its news." className="text-[46px] sm:text-[68px]" />
            <p className="max-w-[520px] text-[19px] leading-relaxed text-[var(--d-muted)] lg:justify-self-end">
              Choose your field and topics at sign-up. The stories PostFlow picks, and the rules your posts follow, come from that.
            </p>
          </div>
          <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {PROFESSIONS.map((p, i) => (
              <div key={p.who} className="card-lift reveal pt-4" style={{ "--d": `${(i % 3) * 80}ms` } as React.CSSProperties}>
                <h3 className="display text-[26px] tracking-[-0.03em]">{p.who}</h3>
                <p className="mt-2 text-[16px] leading-relaxed text-[var(--d-muted)]">{p.watch}</p>
                <p className="typed mt-3 text-[12px] uppercase tracking-[.12em] text-[var(--accent)]">{p.rule}</p>
              </div>
            ))}
          </div>
          <p className="mt-10 text-[16px] text-[var(--d-muted)]">
            Not listed? Choose <span className="font-semibold text-[var(--d-ink)]">Something else</span> and name your topics.
          </p>
        </section>

        <Rule />

        {/* ---------- what's inside ---------- */}
        <section id="desk" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 py-20 sm:px-6 sm:py-24">
          <div className="mb-12 grid gap-6 lg:grid-cols-2 lg:items-end">
            <Headline a="The whole newsroom." b="In one quiet tab." className="text-[46px] sm:text-[68px]" />
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
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
              <Headline a={beta ? "Free on LinkedIn." : "One price a month."} b={beta ? "X when you need it." : "Every post checked."} className="text-[46px] sm:text-[68px]" />
            </div>
            <p className="max-w-[520px] text-[19px] leading-relaxed text-[var(--d-muted)] lg:justify-self-end">
              {beta
                ? "Pro adds X and opens soon."
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
                    ? "Connect LinkedIn and pick your field. Your first drafts are on your calendar the same day."
                    : `Connect LinkedIn or X, pick your field, and your first posts arrive in Telegram today. ${TRIAL_DAYS} days free.`
                  : `PostFlow is opening to a small group first. Join the list for an invite${beta ? " to the free beta." : ` and a ${TRIAL_DAYS}-day free trial.`}`}
              </p>
            </div>
            {open && plan !== "agency" && !(beta && plan) ? (
              <div className="rounded-2xl border-[1.5px] border-[var(--d-sky-line)] bg-[var(--surface)] p-8 shadow-[0_6px_0_var(--d-sky-line)]">
                <a href={signupHref} className="btn-desk w-full">{startLabel}</a>
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
            <a href="#watch" className="hover:text-[var(--d-ink)]">How it works</a>
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
