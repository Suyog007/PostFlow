import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { isLoggedIn } from "@/server/auth";
import { signupsOpen } from "@/server/users";
import { Icon, Logo, PlatformGlyph } from "@/components/ui";
import { Pricing } from "@/components/landing/pricing";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { FlowDiagram, NewsCard, RejectedCard, Shot, TelegramMock } from "@/components/landing/visuals";
import { TRIAL_DAYS } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "PostFlow · LinkedIn and X posts from your notes, checked before they go out",
  description:
    "PostFlow keeps your LinkedIn and X calendar filled with posts written from your own notes and the news in your field. A second AI checks every draft for facts and filler, and nothing posts until you approve it.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "PostFlow",
    description: "LinkedIn and X posts written from your notes, checked before they go out.",
    images: [{ url: "/landing/calendar-light.png", width: 2560, height: 1600 }],
  },
};

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#review", label: "Reviewer" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Will it post something I haven't seen?",
    a: "Not unless you choose that. New accounts start in approval mode: posts are written and placed on your calendar, but nothing is published until you approve it in the app or with one tap in Telegram. On Pro you can switch to auto mode later, where reviewed posts go out on schedule unless you remove them.",
  },
  {
    q: "Does it make things up?",
    a: "It is built not to. First-person claims (\"we shipped\", \"I learned\") only come from notes you wrote. News posts must name their source, and a separate reviewer checks every claim against the article or note it came from. Drafts that fail are rewritten or rejected, and rejected drafts stay visible so you can see what was stopped. The reviewer can only check against the text it was given. It does not search the web, so skim your calendar.",
  },
  {
    q: "What do I need to connect?",
    a: "Your personal LinkedIn profile and your X account, through their official sign-in pages. PostFlow never sees your passwords, and access tokens are stored encrypted. Telegram is optional and free: it is the fastest way to approve posts and send notes from your phone.",
  },
  {
    q: "Why is there no free plan?",
    a: `Every post costs real money to produce: several AI calls to write and review it, and X charges per post published through its API. A free plan would mean cutting the review step, which is the part that makes PostFlow safe to use. Instead, every plan starts with a ${TRIAL_DAYS}-day free trial.`,
  },
  {
    q: "Can I write or change posts myself?",
    a: "Yes. Edit any post before it goes out and your wording is published exactly as written. You can also ask for a reword (\"too formal\", \"don't open with the company name\") and tick \"remember this\" so future posts follow it.",
  },
  {
    q: "Is automated posting allowed on LinkedIn and X?",
    a: "PostFlow publishes through each platform's official API, as you, with content you have reviewed. Both platforms restrict bot-like and spammy automation, which is why PostFlow keeps volume modest, never posts the same thing twice, and keeps approval on by default. You are responsible for what goes out under your name.",
  },
  {
    q: "What languages does it write in?",
    a: "English for now.",
  },
  {
    q: "Can I cancel?",
    a: "Anytime, from your account. Disconnecting an account in Settings stops all posting to it immediately.",
  },
];

function Section({ id, eyebrow, title, intro, children, className = "" }: { id?: string; eyebrow?: string; title: string; intro?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`scroll-mt-20 px-4 py-20 sm:py-24 ${className}`}>
      <div className="mx-auto max-w-[1120px]">
        <div className="mx-auto mb-12 max-w-[680px] text-center">
          {eyebrow && <p className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">{eyebrow}</p>}
          <h2 className="text-[30px] font-semibold leading-[1.15] tracking-tight sm:text-[38px]">{title}</h2>
          {intro && <p className="mt-4 text-[16px] leading-relaxed text-[var(--muted)] sm:text-[17px]">{intro}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

function Feature({ title, body, points, visual, flip, wide }: { title: string; body: string; points: string[]; visual: ReactNode; flip?: boolean; wide?: boolean }) {
  if (wide) {
    return (
      <div>
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-16">
          <div>
            <h3 className="text-[24px] font-semibold leading-tight tracking-tight sm:text-[28px]">{title}</h3>
            <p className="mt-3 text-[16px] leading-relaxed text-[var(--muted)]">{body}</p>
          </div>
          <ul className="space-y-3 lg:pt-2">
            {points.map((p) => (
              <li key={p} className="flex gap-3 text-[15px]">
                <Icon name="check" size={18} className="mt-0.5 flex-none text-[var(--good)]" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-10">{visual}</div>
      </div>
    );
  }
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={flip ? "lg:order-2" : ""}>
        <h3 className="text-[24px] font-semibold leading-tight tracking-tight sm:text-[28px]">{title}</h3>
        <p className="mt-3 text-[16px] leading-relaxed text-[var(--muted)]">{body}</p>
        <ul className="mt-6 space-y-3">
          {points.map((p) => (
            <li key={p} className="flex gap-3 text-[15px]">
              <Icon name="check" size={18} className="mt-0.5 flex-none text-[var(--good)]" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={flip ? "lg:order-1" : ""}>{visual}</div>
    </div>
  );
}

export default async function LandingPage({ searchParams }: { searchParams: Promise<{ plan?: string; deleted?: string }> }) {
  const { plan, deleted } = await searchParams;
  const loggedIn = await isLoggedIn().catch(() => false);
  const open = signupsOpen();
  // Open: buttons lead to sign-up and checkout. Closed: they lead to the waitlist.
  const primary = open ? { href: "/signup?plan=pro&interval=year", label: `Start ${TRIAL_DAYS}-day free trial` } : { href: "#early-access", label: "Get early access" };

  return (
    <div className="bg-[var(--bg)] text-[15px]">
      {/* ---------- nav ---------- */}
      <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--bg)]/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center gap-6 px-4">
          <Link href="/" className="flex items-center gap-2">
            <Logo size={24} />
            <span className="text-[16px] font-semibold tracking-tight">PostFlow</span>
          </Link>
          <nav className="hidden items-center gap-6 text-[14px] text-[var(--muted)] md:flex">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="hover:text-[var(--ink)]">{n.label}</a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {loggedIn ? (
              <Link href="/calendar" className="btn btn-primary h-9 text-[14px]">Open app</Link>
            ) : (
              <>
                <Link href="/login" className="btn btn-ghost h-9 text-[14px]">Sign in</Link>
                <a href={primary.href} className="btn btn-primary h-9 text-[14px]">{open ? "Start free trial" : primary.label}</a>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        {deleted && (
          <p role="status" className="mx-auto mt-4 max-w-[1120px] rounded-md bg-[var(--good-soft)] px-4 py-2 text-[13px] text-[var(--good)]">Your account and its data were deleted, and your subscription was cancelled.</p>
        )}
        {/* ---------- hero ---------- */}
        <section className="px-4 pb-16 pt-16 sm:pt-24">
          <div className="mx-auto max-w-[1120px]">
            <div className="mx-auto max-w-[820px] text-center">
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-[13px] text-[var(--muted)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--good)]" /> For founders, engineers and consultants
              </p>
              <h1 className="text-[38px] font-semibold leading-[1.08] tracking-[-0.02em] sm:text-[56px]">
                A week of LinkedIn and X posts, written from your notes and checked before they go out.
              </h1>
              <p className="mx-auto mt-6 max-w-[640px] text-[17px] leading-relaxed text-[var(--muted)] sm:text-[19px]">
                PostFlow keeps your calendar filled a few days ahead with posts about your work, the news in your field and what you have learned. A second AI reviews every draft for facts and filler. Nothing goes out until you approve it.
              </p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <a href={primary.href} className="btn btn-primary h-11 px-5 text-[15px]">{primary.label}</a>
                <a href="#how" className="btn h-11 px-5 text-[15px]">See how it works</a>
              </div>
              <p className="mt-4 text-[13px] text-[var(--subtle)]">{open ? "No charge during the trial · Cancel anytime" : `${TRIAL_DAYS}-day free trial at launch · No card to join the list`}</p>
            </div>

            {/* On phones the screenshot keeps a readable size and scrolls sideways. */}
            <div className="-mx-4 mt-14 overflow-x-auto px-4 pb-2 sm:mx-0 sm:mt-16 sm:overflow-visible sm:px-0">
              <div className="min-w-[760px] sm:min-w-0 [mask-image:linear-gradient(to_bottom,#000_78%,transparent)]">
                <Shot name="calendar" alt="The PostFlow calendar: a week of scheduled LinkedIn and X posts, some approved, some waiting for approval" width={1280} height={800} priority />
              </div>
            </div>
            <p className="mt-1 text-center text-[12px] text-[var(--subtle)] sm:hidden">Swipe to see the whole week</p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[14px] text-[var(--muted)]">
              <span className="flex items-center gap-2"><PlatformGlyph platform="linkedin" size={18} /> Publishes to LinkedIn</span>
              <span className="flex items-center gap-2"><PlatformGlyph platform="x" size={18} /> Publishes to X</span>
              <span className="flex items-center gap-2"><Icon name="send" size={17} /> Approve from Telegram</span>
              <span className="flex items-center gap-2"><Icon name="clock" size={17} /> Runs in your timezone</span>
            </div>
          </div>
        </section>

        {/* ---------- problem ---------- */}
        <section className="border-y border-[var(--line)] bg-[var(--surface)] px-4 py-16">
          <div className="mx-auto grid max-w-[1120px] gap-8 md:grid-cols-3">
            {[
              { t: "You do work worth talking about.", b: "You ship, fix, learn and decide things every week. Almost none of it turns into a post, because writing one takes an evening." },
              { t: "Schedulers still leave a blank box.", b: "A queue is only useful once you have something to put in it. The hard part was never pressing publish." },
              { t: "AI writers fill the box with filler.", b: "Generic hooks, invented stories and confident claims nobody checked. That costs more trust than posting nothing." },
            ].map((x, i) => (
              <div key={x.t}>
                <p className="mb-2 font-mono text-[12px] text-[var(--subtle)]">0{i + 1}</p>
                <h3 className="text-[18px] font-semibold tracking-tight">{x.t}</h3>
                <p className="mt-2 leading-relaxed text-[var(--muted)]">{x.b}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- how it works ---------- */}
        <Section
          id="how"
          eyebrow="How it works"
          title="You bring the material. PostFlow does the writing, checking and scheduling."
          intro="Setup takes about ten minutes. After that, your part is a few rough notes a week and a quick look at the calendar."
        >
          <ol className="mb-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { t: "Connect your accounts", b: "Sign in with LinkedIn and X through their official pages. Pick your posting times, like weekdays at 09:15." },
              { t: "Tell it who you are", b: "Your role, what you can credibly talk about, how you sound, and topics to avoid." },
              { t: "Drop rough notes", b: "\"Cut CI from 14 to 4 minutes, the cache did most of it.\" In the app or as a Telegram message." },
              { t: "Approve and forget", b: "Posts appear on your calendar days ahead. Approve, tweak or remove them, and they publish on time." },
            ].map((s, i) => (
              <li key={s.t} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ink)] text-[13px] font-semibold text-[var(--bg)]">{i + 1}</span>
                <h3 className="mt-4 text-[16px] font-semibold">{s.t}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--muted)]">{s.b}</p>
              </li>
            ))}
          </ol>
          <FlowDiagram />
        </Section>

        {/* ---------- reviewer ---------- */}
        <Section
          id="review"
          eyebrow="The reviewer"
          title="Every draft is checked before it reaches your calendar."
          intro="Most AI writing tools stop at the first draft. PostFlow writes, then hands the draft to a separate reviewer that has one job: decide whether it is good enough to carry your name."
          className="border-t border-[var(--line)]"
        >
          <div className="space-y-24">
            <Feature
              title="Claims are checked against the source, one by one."
              body="The reviewer pulls out every checkable statement and marks it supported, unsupported or unverifiable against your note or the article. It also scores the draft for whether it is worth posting, factual accuracy and AI filler."
              points={[
                "Pass or fail is decided by fixed thresholds in code, not by the model's mood",
                "Failed drafts are rewritten with the reviewer's notes, up to 3 times",
                "Length, cliché, hashtag and duplicate checks run on top",
              ]}
              visual={
                <div className="space-y-4">
                  <Shot name="review" alt="PostFlow review panel: worth posting 9/10, facts 10/10, human 9/10, with three claims checked against the author's note" width={488} height={330} />
                  <RejectedCard />
                </div>
              }
            />
            <Feature
              wide
              title="See exactly what will be published, and change it in one click."
              body="Each post has a preview that looks like the platform, the reasoning behind it and the controls you need. Nothing is hidden behind an AI black box."
              points={[
                "Approve, edit, move or remove any post",
                "\"Reject, find another\" fills the slot with a different story",
                "Reword with feedback, and PostFlow remembers your preferences",
              ]}
              visual={<Shot name="post" alt="A scheduled LinkedIn post in PostFlow with its editor, a LinkedIn-style preview and an approval banner" width={1020} height={695} />}
            />
          </div>
        </Section>

        {/* ---------- news + telegram ---------- */}
        <Section
          eyebrow="Beyond your notes"
          title="News when it matters. Your phone when you're away."
          intro="Your notes make the best posts. PostFlow fills the gaps with news from your field, but only when the story gives your audience something to act on."
          className="border-t border-[var(--line)] bg-[var(--surface)]"
        >
          <div className="space-y-24">
            <Feature
              title="News posts are openings, not recaps."
              body="Stories are scored for relevance to you and for whether they open something up for your audience: a price drop, a new API, a policy change. They are written as what changed, why it matters and one next step."
              points={[
                "Only posted when other publishers confirm the story",
                "Time-sensitive posts expire instead of going out late",
                "Rare breaking stories take a fast lane, with time for you to veto",
              ]}
              visual={<NewsCard />}
            />
            <Feature
              flip
              title="Run it from Telegram."
              body="Every new post arrives in a Telegram chat with buttons. Approve it on the bus, or send a quick message about what you shipped and it becomes material for an upcoming post."
              points={["Approve or swap a post with one tap", "Any message becomes a note", "/pause stops everything instantly"]}
              visual={<TelegramMock />}
            />
            <Feature
              title="Have a link or an idea? Turn it into a post now."
              body="Paste an idea, an article or your own blog post. PostFlow writes a version for each platform, reviews it and puts it in the next free slot, or holds it as a draft."
              points={["Your own articles are written as their author, with the link", "Choose next free slot, in about 20 minutes, or draft only"]}
              visual={<Shot name="create" alt="PostFlow create form: paste an idea or link, pick LinkedIn and X, and choose when it goes out" width={572} height={309} />}
            />
          </div>
        </Section>

        {/* ---------- guardrails ---------- */}
        <Section
          id="safety"
          eyebrow="Guardrails"
          title="Built to be left alone."
          intro="Automation you have to babysit is not automation. These safeguards are on for every account."
          className="border-t border-[var(--line)]"
        >
          <div className="grid gap-px overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-3">
            {[
              { i: "notes" as const, t: "No invented experience", b: "First-person stories only come from your notes. Evergreen posts stay inside the expertise you listed." },
              { i: "repost" as const, t: "No repeats", b: "Near-duplicates of your recent posts are caught before they are scheduled." },
              { i: "check" as const, t: "No double posting", b: "If a platform does not confirm a post, it is marked for you to check instead of being sent again." },
              { i: "pause" as const, t: "One switch to stop", b: "Pause everything from the app or Telegram. Removed posts are never refilled behind your back." },
              { i: "shield" as const, t: "Your accounts stay yours", b: "Official sign-in only. Access tokens are encrypted at rest, and you can disconnect at any time." },
              { i: "chart" as const, t: "Sensible volume", b: "Daily caps on AI calls and on time-sensitive posts, so your feed never turns into a news ticker." },
            ].map((g) => (
              <div key={g.t} className="bg-[var(--surface)] p-6">
                <Icon name={g.i} size={20} className="text-[var(--accent)]" />
                <h3 className="mt-3 text-[16px] font-semibold">{g.t}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--muted)]">{g.b}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* ---------- pricing ---------- */}
        <Section
          id="pricing"
          eyebrow="Pricing"
          title="Simple plans. Every one includes the reviewer."
          intro="Pick by how much you post. You can change plans or cancel at any time."
          className="border-t border-[var(--line)] bg-[var(--surface)]"
        >
          <Pricing signupsOpen={open} />
        </Section>

        {/* ---------- FAQ ---------- */}
        <Section id="faq" eyebrow="FAQ" title="Questions people ask first." className="border-t border-[var(--line)]">
          <div className="mx-auto max-w-[760px] divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-medium [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span className="flex-none text-[var(--subtle)] transition-transform group-open:rotate-45"><Icon name="create" size={18} /></span>
                </summary>
                <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">{f.a}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* ---------- early access ---------- */}
        <section id="early-access" className="scroll-mt-20 border-t border-[var(--line)] bg-[var(--surface)] px-4 py-20 sm:py-24">
          <div className="mx-auto grid max-w-[1120px] items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">{open ? "Get started" : "Early access"}</p>
              <h2 className="text-[30px] font-semibold leading-[1.15] tracking-tight sm:text-[38px]">Get your calendar filled before your next busy week.</h2>
              <p className="mt-4 text-[16px] leading-relaxed text-[var(--muted)] sm:text-[17px]">
                {open
                  ? `Create your account, connect LinkedIn or X, and drop your first note. Your ${TRIAL_DAYS}-day trial starts when you pick a plan.`
                  : `PostFlow is opening to a small group first. Join the list and you will get an invite with a ${TRIAL_DAYS}-day free trial.`}
              </p>
              <ul className="mt-6 space-y-2.5 text-[15px]">
                {["Set up in about ten minutes", "Approval mode on by default", "Cancel anytime"].map((x) => (
                  <li key={x} className="flex gap-3"><Icon name="check" size={18} className="mt-0.5 flex-none text-[var(--good)]" />{x}</li>
                ))}
              </ul>
            </div>
            {/* The Agency plan is not for sale yet, so its button always leads to the waitlist. */}
            {open && plan !== "agency" ? (
              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 text-center">
                <p className="text-[15px] font-medium">Start with a {TRIAL_DAYS}-day free trial</p>
                <p className="mt-1 text-[13px] text-[var(--muted)]">Starter from $15/month, Pro from $31/month, billed yearly.</p>
                <a href="/signup?plan=pro&interval=year" className="btn btn-primary mt-5 h-11 w-full text-[15px]">Create your account</a>
                <p className="mt-3 text-[13px] text-[var(--muted)]">Already have one? <Link href="/login" className="underline">Sign in</Link></p>
              </div>
            ) : (
              <WaitlistForm plan={plan} />
            )}
          </div>
        </section>
      </main>

      {/* ---------- footer ---------- */}
      <footer className="border-t border-[var(--line)] px-4 py-10">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-6 text-[14px] text-[var(--muted)] sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 text-[var(--ink)]">
            <Logo size={20} />
            <span className="font-semibold">PostFlow</span>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="hover:text-[var(--ink)]">{n.label}</a>
            ))}
            <Link href="/login" className="hover:text-[var(--ink)]">Sign in</Link>
            <Link href="/terms" className="hover:text-[var(--ink)]">Terms</Link>
            <Link href="/privacy" className="hover:text-[var(--ink)]">Privacy</Link>
          </nav>
          <p className="sm:ml-auto">© {new Date().getFullYear()} PostFlow</p>
        </div>
      </footer>
    </div>
  );
}
