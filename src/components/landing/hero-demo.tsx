"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, PlatformGlyph } from "@/components/ui";
import { useInView, usePrefersReducedMotion } from "./motion";

const NOTE = "Cut CI from 14 minutes to 4. The dependency cache did most of it.";
const POST = "CI went from 14 minutes to 4. Caching dependencies did most of the work, so if your pipeline feels slow, look at the cache before you blame the runners.";
const WORDS = POST.split(" ");

const METERS = [
  { label: "Worth posting", value: 9 },
  { label: "Facts", value: 10 },
  { label: "Human", value: 9 },
];
const CLAIMS = [
  { claim: "CI went from 14 minutes to 4", source: "your note" },
  { claim: "Caching did most of the work", source: "your note" },
];

interface Frame {
  note: string;
  phase: number; // 0 typing, 1 writing, 2 draft, 3 review, 4 scheduled, 5 Telegram, 6 approved
  words: number;
  meters: boolean;
  claims: number;
  tap: boolean;
}
const BLANK: Frame = { note: "", phase: 0, words: 0, meters: false, claims: 0, tap: false };
const FINAL: Frame = { note: NOTE, phase: 6, words: WORDS.length, meters: true, claims: CLAIMS.length, tap: true };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Grows open smoothly (no fixed heights), so the stage does not jump as cards appear. */
function Reveal({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div className="grid transition-[grid-template-rows,opacity] duration-500 ease-out motion-reduce:transition-none" style={{ gridTemplateRows: show ? "1fr" : "0fr", opacity: show ? 1 : 0 }}>
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * A looping walkthrough of one post: a rough note becomes a draft, the reviewer checks it, it lands on the
 * calendar and the Telegram heads-up arrives. The numbers are an example, not data from real users.
 */
export function HeroDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { once: false, margin: "0px" });
  const reduced = usePrefersReducedMotion();
  const [f, setF] = useState<Frame>(FINAL);

  useEffect(() => {
    if (reduced) {
      setF(FINAL);
      return;
    }
    if (!visible) return;
    let dead = false;
    (async () => {
      while (!dead) {
        setF(BLANK);
        await sleep(600);
        for (let i = 1; i <= NOTE.length && !dead; i++) {
          setF((p) => ({ ...p, note: NOTE.slice(0, i) }));
          await sleep(26);
        }
        await sleep(450);
        setF((p) => ({ ...p, phase: 1 }));
        await sleep(1100);
        setF((p) => ({ ...p, phase: 2 }));
        for (let i = 1; i <= WORDS.length && !dead; i++) {
          setF((p) => ({ ...p, words: i }));
          await sleep(55);
        }
        await sleep(350);
        setF((p) => ({ ...p, phase: 3, meters: true }));
        await sleep(600);
        for (let c = 1; c <= CLAIMS.length && !dead; c++) {
          setF((p) => ({ ...p, claims: c }));
          await sleep(600);
        }
        await sleep(400);
        setF((p) => ({ ...p, phase: 4 }));
        await sleep(1000);
        setF((p) => ({ ...p, phase: 5 }));
        await sleep(1500);
        setF((p) => ({ ...p, tap: true }));
        await sleep(400);
        setF((p) => ({ ...p, phase: 6 }));
        await sleep(3600);
      }
    })();
    return () => {
      dead = true;
    };
  }, [visible, reduced]);

  const typing = f.phase === 0;

  return (
    <div ref={ref} role="img" aria-label="Animated example: a rough note becomes a LinkedIn draft, the reviewer checks its claims against the note, the post is scheduled and a Telegram message asks for approval." className="relative mx-auto max-w-[920px]">
      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr] lg:items-start" aria-hidden="true">
        {/* ---- the app ---- */}
        {/* fixmyslop-ignore[ui/neon-glow] neutral grey drop shadow under the app window, not a coloured glow */}
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] text-left shadow-[0_1px_0_var(--line),0_30px_60px_-30px_rgba(16,24,40,.28)]">
          <div className="flex items-center gap-1.5 border-b border-[var(--line)] bg-[var(--raised)] px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--line-strong)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--line-strong)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--line-strong)]" />
            <span className="ml-3 text-[12px] text-[var(--subtle)]">Example · one post, start to finish</span>
          </div>

          <div className="space-y-3 p-4 sm:p-5">
            {/* note */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-[var(--muted)]"><Icon name="notes" size={13} /> Your note</div>
              <div className="min-h-[58px] rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3 py-2.5 text-[14px] leading-snug">
                {f.note}
                {typing && <span className="caret" />}
                {!f.note && !typing && null}
              </div>
            </div>

            {/* draft */}
            <Reveal show={f.phase >= 1}>
              <div className="pt-1">
                <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-[var(--muted)]">
                  <PlatformGlyph platform="linkedin" size={14} /> Draft for LinkedIn
                  {f.phase === 1 && <span className="ml-1 text-[var(--subtle)]">writing…</span>}
                </div>
                <div className="min-h-[88px] rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-[14px] leading-relaxed">
                  {f.phase === 1 ? (
                    <div className="space-y-2 pt-1">
                      <div className="h-2.5 w-full animate-pulse rounded bg-[var(--side)] motion-reduce:animate-none" />
                      <div className="h-2.5 w-4/5 animate-pulse rounded bg-[var(--side)] motion-reduce:animate-none" />
                      <div className="h-2.5 w-3/5 animate-pulse rounded bg-[var(--side)] motion-reduce:animate-none" />
                    </div>
                  ) : (
                    WORDS.slice(0, f.words).join(" ")
                  )}
                  {f.phase === 2 && f.words < WORDS.length && <span className="caret" />}
                </div>
              </div>
            </Reveal>

            {/* review */}
            <Reveal show={f.phase >= 3}>
              <div className="rounded-lg border border-[var(--line)] bg-[var(--raised)] p-3">
                <div className="mb-2.5 flex items-center gap-1.5 text-[12px] font-medium text-[var(--muted)]"><Icon name="shield" size={13} /> Reviewer</div>
                <div className="grid grid-cols-3 gap-3">
                  {METERS.map((m) => (
                    <div key={m.label}>
                      <div className="mb-1 flex justify-between text-[11px]"><span className="text-[var(--muted)]">{m.label}</span><span className="font-medium tabular-nums">{f.meters ? m.value : 0}/10</span></div>
                      <div className="h-1.5 rounded-full bg-[var(--side)]">
                        <div className="h-1.5 rounded-full bg-[var(--good)] transition-[width] duration-[900ms] ease-out motion-reduce:transition-none" style={{ width: f.meters ? `${m.value * 10}%` : "0%" }} />
                      </div>
                    </div>
                  ))}
                </div>
                <ul className="mt-3 space-y-1.5 text-[12.5px]">
                  {CLAIMS.map((c, i) => (
                    <li key={c.claim} className={`flex items-center gap-2 transition-opacity duration-300 ${f.claims > i ? "opacity-100" : "opacity-30"}`}>
                      <span className={`flex h-4 w-4 flex-none items-center justify-center rounded-full ${f.claims > i ? "bg-[var(--good-soft)] text-[var(--good)]" : "bg-[var(--side)] text-transparent"}`}><Icon name="check" size={11} /></span>
                      <span>{c.claim}</span>
                      <span className="text-[var(--subtle)]">· supported by {c.source}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>

            {/* status */}
            <Reveal show={f.phase >= 4}>
              <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[12.5px]">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2.5 py-1"><Icon name="calendar" size={13} /> Fri 09:15 · LinkedIn</span>
                {f.phase >= 6 ? (
                  <span className="pop-in inline-flex items-center gap-1.5 rounded-full bg-[var(--good-soft)] px-2.5 py-1 font-medium text-[var(--good)]"><Icon name="check" size={13} /> Approved</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--warn-soft)] px-2.5 py-1 font-medium text-[var(--warn)]"><Icon name="clock" size={13} /> Waiting for your OK</span>
                )}
              </div>
            </Reveal>
          </div>
        </div>

        {/* ---- the Telegram heads-up ---- */}
        <div className="min-h-[190px] lg:mt-24">
          <Reveal show={f.phase >= 5}>
            {/* fixmyslop-ignore[ui/neon-glow] neutral grey drop shadow under the message, not a coloured glow */}
            <div className="rounded-2xl rounded-tl-md border border-[var(--line)] bg-[var(--surface)] p-3.5 text-left text-[13px] leading-relaxed shadow-[0_1px_0_var(--line),0_20px_40px_-24px_rgba(16,24,40,.3)]">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--subtle)]"><Icon name="send" size={12} /> PostFlow bot</div>
              <p className="font-medium">Going out in about 8 minutes</p>
              <p className="text-[var(--muted)]">LinkedIn · Fri 23 Oct, 09:15</p>
              <p className="mt-2 line-clamp-3">{POST}</p>
              {f.phase >= 6 ? (
                <p className="pop-in mt-2.5 text-[var(--good)]">Approved. It goes out on time unless you remove it.</p>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-1.5 text-center text-[12px] font-medium">
                  <span className={`rounded-lg border px-2 py-2 transition-all duration-200 ${f.tap ? "scale-95 border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]" : "border-[var(--line)] bg-[var(--raised)]"}`}>Approve</span>
                  <span className="rounded-lg border border-[var(--line)] bg-[var(--raised)] px-2 py-2">Remove</span>
                </div>
              )}
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  );
}
