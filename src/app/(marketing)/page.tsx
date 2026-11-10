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
import { BETA, TRIAL_DAYS } from "@/lib/pricing";
import { contactEmail, env } from "@/server/env";

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
    a: "No. Every post waits for you to tap Approve. One you don't approve is skipped, never posted.",
  },
  {
    q: "Do I need Telegram?",
    a: "No. It's optional: it sends each post to your phone so you can approve it from there.",
  },
  {
    q: "Does it make things up?",
    a: "It's built not to. News posts name their source, each claim is checked against the article, and posts about you only come from ideas you give it. It can still get something wrong, which is why you approve first.",
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
/** A section title. Only the hero gets a second line in the accent colour. */
function Headline({ a, b, as: Tag = "h2", className = "" }: { a: ReactNode; b?: ReactNode; as?: "h1" | "h2"; className?: string }) {
  return (
    <Tag className={`display ${className}`}>
      {a}
      {b && (
        <>
          <br />
          <span className="red">{b}</span>
        </>
      )}
    </Tag>
  );
}


/** One line per profession: what PostFlow watches for them, and the rule their posts follow. */
const PROFESSIONS = [
  { who: "Software engineers", watch: "Launches, security alerts and AI news in your stack.", rule: "Explains every acronym" },
  { who: "Doctors & clinicians", watch: "Guideline changes, recalls and strong new studies in your speciality.", rule: "Never gives medical advice" },
  { who: "Accountants & finance", watch: "Tax changes, filing deadlines and new reporting standards.", rule: "Always names the country" },
  { who: "Lawyers & compliance", watch: "New laws, rulings and compliance deadlines in your area.", rule: "Always names the jurisdiction" },
  { who: "Marketers & sales", watch: "Platform, algorithm and privacy changes that move your numbers.", rule: "Never invents results" },
  { who: "Teachers & educators", watch: "Exam, curriculum and policy changes, and what the evidence says.", rule: "Never names a student" },
];


/** The three steps, each with a small picture of what happens. */
function Steps() {
  return (
    <ol className="grid gap-5 md:grid-cols-3">
      <li className="reveal flex flex-col rounded-[16px] border border-[var(--line-strong)] bg-[var(--surface)] p-6" style={{ "--d": "0ms" } as React.CSSProperties}>
        <div className="flex h-[150px] flex-wrap content-center items-center justify-center gap-2 rounded-[12px] bg-[var(--bg)] p-4" aria-hidden="true">
          {["Doctor", "Accountant", "Engineer", "Lawyer", "Teacher", "Marketer"].map((j, i) => (
            <span key={j} className={`rounded-full border px-3 py-1 text-[13px] ${i === 1 ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]" : "border-[var(--line-strong)] text-[var(--muted)]"}`}>{j}</span>
          ))}
        </div>
        <p className="mt-5 text-[13px] font-medium text-[var(--accent)]">Step 1</p>
        <h3 className="mt-1 text-[21px] font-semibold">Tell it what you do</h3>
        <p className="mt-2 text-[16px] leading-relaxed text-[var(--d-muted)]">Pick your job and a few topics you know well. Takes two minutes.</p>
      </li>
      <li className="reveal flex flex-col rounded-[16px] border border-[var(--line-strong)] bg-[var(--surface)] p-6" style={{ "--d": "80ms" } as React.CSSProperties}>
        <div className="flex h-[150px] flex-col justify-center gap-2 rounded-[12px] bg-[var(--bg)] p-4" aria-hidden="true">
          {[["HMRC raises VAT threshold to £90,000", true], ["Celebrity buys third island", false], ["Ten phone cases ranked by colour", false]].map(([t, keep]) => (
            <span key={String(t)} className={`flex items-center gap-2 rounded-[8px] border px-3 py-1.5 text-[13px] ${keep ? "border-[var(--good)]/50 bg-[var(--surface)] font-medium" : "border-[var(--line)] text-[var(--subtle)] line-through"}`}>
              <span className={`h-2 w-2 flex-none rounded-full ${keep ? "bg-[var(--good)]" : "bg-[var(--line-strong)]"}`} />{t}
            </span>
          ))}
        </div>
        <p className="mt-5 text-[13px] font-medium text-[var(--accent)]">Step 2</p>
        <h3 className="mt-1 text-[21px] font-semibold">It writes from the news</h3>
        <p className="mt-2 text-[16px] leading-relaxed text-[var(--d-muted)]">PostFlow reads the news in your field, keeps what your readers should know, and writes a short post that names its source.</p>
      </li>
      <li className="reveal flex flex-col rounded-[16px] border border-[var(--line-strong)] bg-[var(--surface)] p-6" style={{ "--d": "160ms" } as React.CSSProperties}>
        <div className="flex h-[150px] flex-col justify-center gap-3 rounded-[12px] bg-[var(--bg)] p-4" aria-hidden="true">
          <span className="flex items-center gap-2 text-[14px] font-medium"><span className="h-2.5 w-2.5 rounded-full bg-[var(--warn)]" />1 post is waiting for your OK</span>
          <span className="flex gap-2">
            <span className="inline-flex h-10 items-center gap-1.5 rounded-[8px] bg-[var(--ink)] px-4 text-[14px] font-semibold text-[var(--bg)]">✓ Approve</span>
            <span className="inline-flex h-10 items-center rounded-[8px] border border-[var(--line-strong)] px-4 text-[14px]">Edit</span>
          </span>
        </div>
        <p className="mt-5 text-[13px] font-medium text-[var(--accent)]">Step 3</p>
        <h3 className="mt-1 text-[21px] font-semibold">You tap Approve</h3>
        <p className="mt-2 text-[16px] leading-relaxed text-[var(--d-muted)]">Read it, change it if you like, approve it. Nothing goes out without your OK.</p>
      </li>
    </ol>
  );
}

export default async function LandingPage({ searchParams }: { searchParams: Promise<{ plan?: string; deleted?: string }> }) {
  const { plan, deleted } = await searchParams;
  const loggedIn = await isLoggedIn().catch(() => false);
  const open = signupsOpen();
  const beta = env().FREE_BETA;
  const FAQ = faqFor(beta);
  const startLabel = beta ? "Try it free" : `Start my ${TRIAL_DAYS}-day trial`;
  const signupHref = beta ? "/signup" : "/signup?plan=pro&interval=year";
  const cta = open ? { href: signupHref, label: startLabel } : { href: "#early-access", label: "Get early access" };
  const H = "text-[36px] leading-[1.06] sm:text-[52px]";

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
      <DeskNav loggedIn={loggedIn} cta={loggedIn ? undefined : cta} />

      <main id="main" tabIndex={-1} className="outline-none">
        {deleted && <p role="status" className="mx-auto mt-4 max-w-[1200px] px-4 text-[14px]">Your account and its data were deleted, and your subscription was cancelled.</p>}

        {/* ---------- hero ---------- */}
        <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 pb-20 pt-10 sm:px-6 lg:grid-cols-[1fr_1fr] lg:gap-16 lg:pt-16">
          <div>
            <Headline as="h1" a="Be seen on LinkedIn" b="without the writing" className="text-[46px] leading-[1.02] sm:text-[68px]" />
            <p className="mt-6 max-w-[520px] text-[19px] leading-[1.6] text-[var(--d-muted)] sm:text-[21px]">
              PostFlow follows the news in your field and writes short, clear posts in your voice. You read each one and tap Approve. That&apos;s it.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a href={cta.href} className="btn-desk">{cta.label}</a>
              <a href="#how" className="btn-outline">See how it works</a>
            </div>
            <p className="mt-3 text-[14px] text-[var(--d-muted)]">{beta ? "Free during the beta. No card needed." : open ? "No charge during the trial. Cancel anytime." : `${TRIAL_DAYS}-day free trial at launch. No card to join.`}</p>
          </div>
          <HeroDemo />
        </section>

        {/* ---------- how it works ---------- */}
        <section id="how" className="scroll-mt-24 border-y border-[var(--line)] bg-[var(--surface)]/50">
          <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 sm:py-24">
            <Headline a="How it works" className={H} />
            <p className="mt-4 max-w-[560px] text-[19px] leading-relaxed text-[var(--d-muted)]">Set it up once. After that, posts show up for you to approve.</p>
            <div className="mt-10"><Steps /></div>
          </div>
        </section>

        {/* ---------- a real post ---------- */}
        <section id="real" className="mx-auto grid max-w-[1200px] scroll-mt-24 items-center gap-10 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div>
            <Headline a="A real post it wrote" className={H} />
            <p className="mt-6 max-w-[480px] text-[19px] leading-relaxed text-[var(--d-muted)]">
              PostFlow found this story, wrote the post, checked it against the article and waited for approval. It reached 263 people in its first 11 minutes.
            </p>
            <p className="mt-4 text-[14px] text-[var(--d-muted)]">Published on LinkedIn. Name and photo changed for privacy.</p>
          </div>
          <figure className="reveal overflow-hidden rounded-[12px] border border-[var(--line-strong)] bg-white shadow-[0_18px_40px_-22px_rgba(24,34,30,.45)]">
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

        {/* ---------- who it's for ---------- */}
        <section id="who" className="scroll-mt-24 border-y border-[var(--line)] bg-[var(--surface)]/50">
          <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 sm:py-24">
            <Headline a="Made for your job" className={H} />
            <p className="mt-4 max-w-[560px] text-[19px] leading-relaxed text-[var(--d-muted)]">It knows what matters in your field, and the rules your posts should follow.</p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PROFESSIONS.map((p, i) => (
                <div key={p.who} className="reveal rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-5" style={{ "--d": `${(i % 3) * 80}ms` } as React.CSSProperties}>
                  <h3 className="text-[18px] font-semibold">{p.who}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--d-muted)]">{p.watch}</p>
                  <p className="mt-3 flex items-center gap-1.5 text-[14px] text-[var(--accent)]"><span aria-hidden="true">✓</span>{p.rule}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-[16px] text-[var(--d-muted)]">Something else? Pick &ldquo;Something else&rdquo; and name your topics.</p>
          </div>
        </section>

        {/* ---------- pricing ---------- */}
        <section id="pricing" className="mx-auto max-w-[1200px] scroll-mt-24 px-4 py-20 sm:px-6 sm:py-24">
          {beta ? (
            <div className="mx-auto max-w-[560px] text-center">
              <Headline a="Free while we're in beta" className={H} />
              <div className="mt-10 rounded-[16px] border border-[var(--ink)] bg-[var(--surface)] p-8 text-left">
                <p className="text-[15px] font-medium text-[var(--accent)]">Free beta</p>
                <p className="mt-1 flex items-baseline gap-1.5"><span className="text-[44px] font-semibold tnum">$0</span><span className="text-[16px] text-[var(--d-muted)]">a month, no card</span></p>
                <ul className="mt-6 space-y-3 text-[16px]">
                  {["Your LinkedIn account", `Up to ${BETA.quota.postsPerMonth} posts a month`, "Every post checked before you see it", "You approve every post", "Ideas from your own work, too"].map((l) => (
                    <li key={l} className="flex gap-3"><span aria-hidden="true" className="text-[var(--good)]">✓</span>{l}</li>
                  ))}
                </ul>
                <a href={open ? "/signup" : "#early-access"} className="btn-desk mt-8 w-full">{open ? "Try it free" : "Get early access"}</a>
              </div>
              <p className="mt-5 text-[15px] text-[var(--d-muted)]">
                A paid plan with X (Twitter) is coming. <a href="/?plan=pro#early-access" className="underline">Get notified</a>
              </p>
            </div>
          ) : (
            <>
              <Headline a="One price a month" className={H} />
              <div className="mt-10"><Pricing signupsOpen={open} beta={beta} /></div>
            </>
          )}
        </section>

        {/* ---------- FAQ ---------- */}
        <section id="faq" className="border-t border-[var(--line)]">
          <div className="mx-auto grid max-w-[1200px] scroll-mt-24 gap-10 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[0.8fr_1.2fr]">
            <Headline a="Questions" className={H} />
            <div className="divide-y divide-[var(--d-sky-line)] border-y border-[var(--d-sky-line)]">
              {FAQ.map((f) => (
                <details key={f.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[18px] font-semibold [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span aria-hidden="true" className="red flex-none text-[26px] leading-none transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 max-w-[640px] text-[16px] leading-relaxed text-[var(--d-muted)]">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- last call ---------- */}
        <section id="early-access" className="scroll-mt-24 bg-[var(--d-sky)]">
          <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-2">
            <div>
              <Headline a="Your next post is already in the news" className={H} />
              <p className="mt-6 max-w-[500px] text-[19px] leading-relaxed text-[var(--d-muted)]">
                {open && beta && plan
                  ? `The ${plan === "agency" ? "Agency" : "Pro"} plan adds X and opens soon. Join the list and you will hear first. Until then, LinkedIn is free.`
                  : open
                  ? beta
                    ? "Sign up, connect LinkedIn and pick your field. Your first posts are ready the same day."
                    : `Connect LinkedIn or X, pick your field, and your first posts arrive today. ${TRIAL_DAYS} days free.`
                  : `PostFlow is opening to a small group first. Join the list for an invite${beta ? " to the free beta." : ` and a ${TRIAL_DAYS}-day free trial.`}`}
              </p>
            </div>
            {open && plan !== "agency" && !(beta && plan) ? (
              <div className="rounded-[16px] border border-[var(--line-strong)] bg-[var(--surface)] p-8">
                <a href={signupHref} className="btn-desk w-full">{startLabel}</a>
                <p className="mt-4 text-center text-[15px] text-[var(--d-muted)]">
                  Already have an account? <Link href="/login" className="font-semibold underline">Sign in</Link>
                </p>
              </div>
            ) : (
              <WaitlistForm plan={plan} />
            )}
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-[1200px] px-4 pb-10 pt-10 sm:px-6">
        <div className="flex flex-col gap-5 text-[15px] text-[var(--d-muted)] sm:flex-row sm:items-center">
          <span className="flex items-center gap-2 text-[var(--d-ink)]">
            <Logo size={22} />
            <span className="display text-[22px]">PostFlow</span>
          </span>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            <a href="#how" className="hover:text-[var(--d-ink)]">How it works</a>
            <a href="#pricing" className="hover:text-[var(--d-ink)]">Pricing</a>
            <a href="#faq" className="hover:text-[var(--d-ink)]">Questions</a>
            <Link href="/terms" className="hover:text-[var(--d-ink)]">Terms</Link>
            <Link href="/privacy" className="hover:text-[var(--d-ink)]">Privacy</Link>
            {contactEmail() && <a href={`mailto:${contactEmail()}`} className="hover:text-[var(--d-ink)]">Contact</a>}
          </nav>
          <p className="sm:ml-auto">© {new Date().getFullYear()} PostFlow</p>
        </div>
      </footer>
    </div>
  );
}
