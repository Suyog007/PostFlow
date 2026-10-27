import Link from "next/link";
import type { ReactNode } from "react";
import { Logo, PlatformGlyph } from "./ui";

const STEPS = [
  { t: "Pick your field and topics", b: "Engineer, doctor, accountant, lawyer or anything else." },
  { t: "PostFlow reads the news", b: "It writes a clear post and checks every fact against the source." },
  { t: "You approve in one tap", b: "On Telegram, ten minutes before it goes out. Nothing posts without you." },
];

const PROFESSIONS = ["Engineers", "Doctors", "Accountants", "Lawyers", "Marketers", "Teachers"];

/** The left half on wide screens: what PostFlow does, so the form is not alone on an empty page. */
function Pitch() {
  return (
    <aside className="hidden flex-col justify-between border-r border-[var(--line)] bg-[var(--side)] px-12 py-10 lg:flex">
      <Link href="/" className="flex items-center gap-2.5">
        <Logo size={28} />
        <span className="display text-[24px]">PostFlow</span>
      </Link>

      <div className="mx-auto w-full max-w-[460px] py-10">
        <p className="display text-[44px] leading-[1.02]">
          The news breaks.
          <br />
          <span className="italic text-[var(--accent)]">Your post is ready.</span>
        </p>
        <ol className="mt-8 space-y-5">
          {STEPS.map((s, i) => (
            <li key={s.t} className="flex gap-4">
              <span className="typed flex h-7 w-7 flex-none items-center justify-center rounded-full border border-[var(--ink)] text-[13px] font-semibold">{i + 1}</span>
              <span>
                <span className="block text-[15px] font-semibold">{s.t}</span>
                <span className="block text-[14px] text-[var(--muted)]">{s.b}</span>
              </span>
            </li>
          ))}
        </ol>

        {/* A sample post, labelled as one: made-up story. */}
        <figure className="mt-9 -rotate-[0.6deg] rounded-[4px] border border-[var(--line-strong)] bg-[var(--surface)] p-4 shadow-[0_14px_30px_-20px_rgba(24,34,30,.45)]">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--mark-soft)] text-[12px] font-bold" aria-hidden="true">DR</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold">Dr. Rana</p>
              <p className="text-[11px] text-[var(--muted)]">Eye doctor · now</p>
            </div>
            <PlatformGlyph platform="linkedin" size={16} />
          </div>
          <p className="mt-3 text-[13px] leading-relaxed">
            Children should now have their first eye check at three, not five. The Eye Health Council changed its screening advice this week. General information, not medical advice.
          </p>
          <figcaption className="typed mt-3 text-[11px] uppercase tracking-[.1em] text-[var(--subtle)]">Sample post · made-up story</figcaption>
        </figure>
      </div>

      <div>
        <p className="typed text-[11px] uppercase tracking-[.12em] text-[var(--subtle)]">Made for</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {PROFESSIONS.map((p) => (
            <li key={p} className="rounded-full border border-[var(--line-strong)] px-3 py-1 text-[12px]">{p}</li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

/** Frame for sign-in, sign-up and other account pages. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <Pitch />
      <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px]">
          <Link href="/" className="mb-6 flex items-center gap-2.5 lg:hidden">
            <Logo size={28} />
            <span className="display text-[24px]">PostFlow</span>
          </Link>
          <h1 className="display text-[34px] leading-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] text-[var(--muted)]">{subtitle}</p>}
          <div className="panel mt-6 p-6">{children}</div>
          {footer && <div className="mt-4 text-center text-[13px] text-[var(--muted)]">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
