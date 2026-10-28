"use client";

// "Watch it work": a short looping motion piece that shows what PostFlow does, step by step.
// Not a recording of the app: made-up outlets and stories, drawn in the page's newsprint style.

import { useEffect, useRef, useState } from "react";
import { useInView, usePrefersReducedMotion } from "./motion";

const SCENES = [
  { id: "news", label: "News breaks", caption: "Hundreds of stories land every day. PostFlow reads them all, from the outlets and topics of your field.", ms: 4200 },
  { id: "pick", label: "Picks yours", caption: "It keeps the few that matter to you and your readers, and skips the noise.", ms: 4600 },
  { id: "write", label: "Writes", caption: "It writes a short, clear post in your voice, naming where the news comes from.", ms: 5600 },
  { id: "check", label: "Checks twice", caption: "Every claim is checked against the source. A second, independent model checks again.", ms: 5000 },
  { id: "approve", label: "You approve", caption: "Ten minutes before it goes out, Telegram asks for your OK. One tap.", ms: 4600 },
  { id: "live", label: "Goes live", caption: "It posts at the right time, and your readers see you first on the news that matters.", ms: 4600 },
] as const;

const HEADLINES = [
  { src: "Health Daily", t: "Screening advice for children's eyes changes this week", keep: true, score: 9 },
  { src: "The Ledger", t: "Celebrity buys third island, sources say", keep: false },
  { src: "MedWire", t: "Large trial: new drops slow glaucoma in older adults", keep: true, score: 8 },
  { src: "Gadget Post", t: "Ten phone cases ranked by colour", keep: false },
  { src: "City Times", t: "Football transfer rumours, day 41", keep: false },
  { src: "Science Now", t: "Mouse study hints at faster eye healing", keep: false, score: 4 },
];

const POST = "Children should now have their first eye check at three, not five.\n\nThe Eye Health Council changed its advice this week: lazy eye responds best to treatment when it is caught young, per Health Daily.";

export function NewsFilm() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: false, margin: "0px" });
  const reduced = usePrefersReducedMotion();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const playing = inView && !paused && !reduced;

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setI((n) => (n + 1) % SCENES.length), SCENES[i].ms);
    return () => clearTimeout(t);
  }, [i, playing]);

  const scene = SCENES[i];
  return (
    <div ref={ref} className="film">
      <div className="film-stage" aria-hidden="true">
        {/* The key restarts each scene's animations every time it comes round. */}
        <div key={`${scene.id}-${playing}`} className={`film-scene ${playing ? "is-playing" : "is-still"}`}>
          {scene.id === "news" && <SceneNews />}
          {scene.id === "pick" && <ScenePick />}
          {scene.id === "write" && <SceneWrite playing={playing} />}
          {scene.id === "check" && <SceneCheck />}
          {scene.id === "approve" && <SceneApprove />}
          {scene.id === "live" && <SceneLive />}
        </div>
      </div>

      <p className="mt-5 min-h-[56px] max-w-[720px] text-[18px] leading-relaxed" aria-live="polite">
        <span className="typed mr-2 text-[13px] uppercase tracking-[.14em] text-[var(--accent)]">Step {i + 1}</span>
        {scene.caption}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ol className="flex flex-1 gap-1.5" aria-label="Steps">
          {SCENES.map((s, n) => (
            <li key={s.id} className="flex-1">
              <button type="button" onClick={() => setI(n)} aria-current={n === i ? "step" : undefined} aria-label={`Step ${n + 1}: ${s.label}`} className="group block w-full text-left">
                <span className="film-bar">
                  <span className={n < i ? "film-fill is-done" : n === i ? `film-fill ${playing ? "is-running" : "is-done"}` : "film-fill"} style={n === i && playing ? { animationDuration: `${s.ms}ms` } : undefined} />
                </span>
                <span className={`typed mt-1.5 hidden text-[11px] uppercase tracking-[.1em] sm:block ${n === i ? "text-[var(--d-ink)]" : "text-[var(--d-muted)] group-hover:text-[var(--d-ink)]"}`}>{s.label}</span>
              </button>
            </li>
          ))}
        </ol>
        {!reduced && (
          <button type="button" onClick={() => setPaused((p) => !p)} className="btn-outline h-9 px-3 text-[13px]" aria-label={paused ? "Play the animation" : "Pause the animation"}>
            {paused ? "Play" : "Pause"}
          </button>
        )}
      </div>
      <p className="typed mt-3 text-[11px] uppercase tracking-[.1em] text-[var(--d-muted)]">Illustration · made-up outlets and stories</p>
    </div>
  );
}

/* ---------------------------------------------------------------- scenes */

function Sources({ dim }: { dim?: boolean }) {
  return (
    <div className="film-sources grid gap-2.5 sm:grid-cols-2">
      {HEADLINES.map((h, n) => (
        <div
          key={h.t}
          className={`film-card ${dim ? (h.keep ? "film-keep" : "film-out") : "film-pop"}`}
          style={{ animationDelay: dim ? `${500 + n * 140}ms` : `${n * 260}ms` }}
        >
          <span className="typed text-[10px] uppercase tracking-[.12em] text-[var(--d-muted)]">{h.src}</span>
          <span className="mt-1 block text-[14px] font-semibold leading-snug">{h.t}</span>
          {dim && h.score !== undefined && (
            <span className={`film-score film-pop ${h.keep ? "is-high" : ""}`} style={{ animationDelay: `${900 + n * 120}ms` }}>
              {h.score}/10
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function SceneNews() {
  return (
    <div>
      <SceneTitle>The news breaks.</SceneTitle>
      <Sources />
    </div>
  );
}

function ScenePick() {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 film-pop">
        <span className="typed text-[11px] uppercase tracking-[.12em] text-[var(--d-muted)]">Your field</span>
        <span className="film-chip">Eye doctor</span>
        <span className="film-chip">glaucoma</span>
        <span className="film-chip">children's eyes</span>
      </div>
      <Sources dim />
    </div>
  );
}

function SceneWrite({ playing }: { playing: boolean }) {
  const [n, setN] = useState(playing ? 0 : POST.length);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setN((c) => (c >= POST.length ? c : c + 3)), 26);
    return () => clearInterval(t);
  }, [playing]);
  return (
    <div className="mx-auto max-w-[560px]">
      <PostCard>
        <p className="whitespace-pre-line text-[15px] leading-relaxed">
          {POST.slice(0, n)}
          {n < POST.length && <span className="film-caret" />}
        </p>
      </PostCard>
    </div>
  );
}

function SceneCheck() {
  const claims = ["First eye check moves from five to three", "Changed by the Eye Health Council this week", "Lazy eye responds best when caught young"];
  return (
    <div className="mx-auto grid max-w-[720px] gap-5 sm:grid-cols-[1.2fr_1fr] sm:items-center">
      <div className="space-y-2.5">
        {claims.map((c, n) => (
          <div key={c} className="film-card film-pop flex items-start gap-2.5" style={{ animationDelay: `${n * 450}ms` }}>
            <span className="film-tick film-pop" style={{ animationDelay: `${n * 450 + 350}ms` }}>✓</span>
            <span className="text-[14px] leading-snug">
              {c}
              <span className="typed mt-1 block text-[10px] uppercase tracking-[.1em] text-[var(--d-muted)]">Found in the source</span>
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-col items-center gap-4">
        <span className="stamp film-stamp" style={{ animationDelay: "1700ms" }}>Fact-checked</span>
        <span className="stamp film-stamp" style={{ animationDelay: "2700ms" }}>2nd opinion ✓</span>
      </div>
    </div>
  );
}

function SceneApprove() {
  return (
    <div className="mx-auto flex max-w-[360px] flex-col gap-3">
      <div className="film-phone film-pop">
        <div className="typed mb-2 text-[10px] uppercase tracking-[.12em] text-[var(--d-muted)]">Telegram · PostFlow</div>
        <div className="film-bubble">
          <p className="text-[13px] leading-snug">LinkedIn post at 09:15. Approve it?</p>
          <p className="mt-2 border-l-2 border-[var(--line-strong)] pl-2 text-[12px] leading-snug text-[var(--d-muted)]">Children should now have their first eye check at three, not five…</p>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <span className="film-tg film-press">✅ Approve</span>
          <span className="film-tg">🔁 Other story</span>
        </div>
      </div>
      <div className="film-toast film-pop" style={{ animationDelay: "2200ms" }}>Approved. Goes out at 09:15.</div>
    </div>
  );
}

function SceneLive() {
  return (
    <div className="mx-auto max-w-[560px]">
      <PostCard live>
        <p className="whitespace-pre-line text-[15px] leading-relaxed">{POST}</p>
      </PostCard>
      <div className="mt-3 flex flex-wrap gap-2">
        {["👍 128", "💬 24", "↻ 17"].map((r, n) => (
          <span key={r} className="film-chip film-pop" style={{ animationDelay: `${700 + n * 350}ms` }}>{r}</span>
        ))}
      </div>
    </div>
  );
}

function SceneTitle({ children }: { children: React.ReactNode }) {
  return <p className="display film-pop mb-4 text-[28px] sm:text-[34px]">{children}</p>;
}

function PostCard({ children, live }: { children: React.ReactNode; live?: boolean }) {
  return (
    <div className="film-card film-pop p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--d-cream)] text-[12px] font-bold">DR</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold">Dr. Rana</span>
          <span className="block text-[11px] text-[var(--d-muted)]">Eye doctor · {live ? "just now" : "draft"}</span>
        </span>
        <span className="rounded-[3px] bg-[#0a66c2] px-1.5 text-[11px] font-bold text-white">in</span>
      </div>
      {children}
    </div>
  );
}
