"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { ChevronDown, Send, CalendarClock, Check, ImageIcon, Sparkles } from "lucide-react";
import type { ActionResult } from "@/app/actions";
import {
  approveAndScheduleAction,
  attachCardAction,
  attachOgImageAction,
  detachMediaAction,
  generateImageAction,
  makeCarouselAction,
  rejectAction,
  reviseAction,
  saveRevisionDirectAction,
} from "@/app/actions";
import { ActionButton, ActionForm, ResultMessage } from "./client";
import { xCostEstimate } from "@/lib/x-cost";

const URL_RE = /https?:\/\/[^\s]+/g;
function xLength(text: string) {
  let len = 0;
  const rest = text.replace(URL_RE, () => {
    len += 23;
    return "";
  });
  for (const ch of rest) {
    const cp = ch.codePointAt(0)!;
    len += cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247) ? 1 : 2;
  }
  return len;
}

const REWRITES: [string, string][] = [
  ["shorter", "Shorter"],
  ["longer", "Longer"],
  ["analytical", "More analytical"],
  ["conversational", "More casual"],
  ["creative", "More creative"],
  ["add_source", "Add source link"],
  ["regenerate", "New version"],
];

const FORMAT_PRESETS: [string, string][] = [
  ["whatif", "What if…"],
  ["contrarian", "Contrarian"],
  ["takeaways", "3 takeaways"],
  ["quote_take", "Quote + take"],
  ["question", "One question"],
  ["tip", "Practical tip"],
  ["opportunity", "Opportunity"],
];

export interface QualityIssue {
  code: string;
  severity: string;
  message: string;
}

export function DraftWorkbench({
  draftId,
  platform,
  initial,
  approved,
  suggestion,
  minLocal,
  paused,
  aiEnabled,
  media,
  quality,
  linkInReply,
  imageGenEnabled,
  isCarousel,
}: {
  draftId: string;
  platform: "x" | "linkedin";
  initial: string[];
  approved: boolean;
  suggestion: { local: string; label: string; reason: string } | null;
  minLocal: string;
  paused: boolean;
  aiEnabled: boolean;
  media: { id: string; alt: string }[];
  quality: QualityIssue[];
  linkInReply: boolean;
  imageGenEnabled: boolean;
  isCarousel: boolean;
}) {
  const [parts, setParts] = useState(initial);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [more, setMore] = useState(false);
  const [images, setImages] = useState(false);
  const [pick, setPick] = useState(suggestion?.local ?? minLocal);
  const [angle, setAngle] = useState("");
  const router = useRouter();
  const key = initial.join("\u0000");
  useEffect(() => setParts(initial), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const limit = platform === "x" ? 280 : 3000;
  const len = (t: string) => (platform === "x" ? xLength(t) : [...t].length);
  const dirty = parts.join("\u0000") !== key;
  const tooLong = parts.some((p) => len(p) > limit);
  const name = platform === "x" ? "X" : "LinkedIn";
  const cost = platform === "x" && !isCarousel ? xCostEstimate(parts, media.length, linkInReply) : null;

  const run = (label: string, fn: () => Promise<ActionResult>) =>
    start(async () => {
      setBusy(label);
      setResult(null);
      const r = await fn();
      setResult(r);
      setBusy(null);
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {quality.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/30">
          <div className="font-medium text-warn">Before you approve</div>
          <ul className="mt-1 space-y-0.5">
            {quality.map((q, i) => (
              <li key={i} className={q.severity === "info" ? "text-muted" : ""}>
                • {q.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {parts.map((p, i) => {
        const n = len(p);
        return (
          <div key={i}>
            {parts.length > 1 && (
              <div className="mb-1 text-xs text-muted">
                Post {i + 1} of {parts.length} in thread
                {i === 0 && media.length > 0 ? " · image on this post" : ""}
              </div>
            )}
            <textarea
              value={p}
              disabled={pending}
              onChange={(e) => setParts(parts.map((x, j) => (j === i ? e.target.value : x)))}
              rows={platform === "x" ? 4 : 11}
              className="input prose-post text-[15px]"
            />
            <div className="mt-1 flex justify-between text-xs">
              <span className={clsx(n > limit ? "font-semibold text-bad" : "text-muted")}>
                {n} / {limit}
              </span>
              {platform === "x" && parts.length > 1 && (
                <button type="button" className="text-muted hover:text-ink" onClick={() => setParts(parts.filter((_, j) => j !== i))}>
                  Remove
                </button>
              )}
            </div>
          </div>
        );
      })}
      {platform === "x" && parts.length < 15 && !isCarousel && (
        <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => setParts([...parts, ""])}>
          + Add another post (thread)
        </button>
      )}

      {aiEnabled && (
        <>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted">Rewrite:</span>
            {REWRITES.map(([k, l]) => (
              <button
                key={k}
                type="button"
                disabled={pending || dirty}
                title={dirty ? "Save or discard your edits first" : undefined}
                className="rounded-full border border-line px-2.5 py-1 hover:border-accent hover:text-accent disabled:opacity-40"
                onClick={() => run(`rewrite:${k}`, () => reviseAction(draftId, k, undefined))}
              >
                {busy === `rewrite:${k}` ? "Rewriting…" : l}
              </button>
            ))}
            <input
              value={angle}
              onChange={(e) => setAngle(e.target.value)}
              placeholder="or describe an angle…"
              className="min-w-40 flex-1 rounded-full border border-line bg-card px-3 py-1 outline-none focus:border-accent"
              onKeyDown={(e) => {
                if (e.key === "Enter" && angle.trim().length > 2 && !dirty) {
                  e.preventDefault();
                  run("angle", () => reviseAction(draftId, "angle", angle.trim()));
                  setAngle("");
                }
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted">Format:</span>
            {[...FORMAT_PRESETS, ...(platform === "x" && !isCarousel ? ([["thread", "Expand to thread"]] as [string, string][]) : [])].map(([k, l]) => (
              <button
                key={k}
                type="button"
                disabled={pending || dirty}
                title={dirty ? "Save or discard your edits first" : undefined}
                className="rounded-full border border-line px-2.5 py-1 hover:border-accent hover:text-accent disabled:opacity-40"
                onClick={() => run(`format:${k}`, () => reviseAction(draftId, k, undefined))}
              >
                {busy === `format:${k}` ? "Rewriting…" : l}
              </button>
            ))}
            {platform === "linkedin" && !isCarousel && (
              <button
                type="button"
                disabled={pending}
                title="Writes ~7 slides and renders them as images (about a minute)"
                className="rounded-full border border-line px-2.5 py-1 hover:border-accent hover:text-accent disabled:opacity-40"
                onClick={() => run("carousel", () => makeCarouselAction(draftId))}
              >
                {busy === "carousel" ? "Building slides…" : "Make carousel"}
              </button>
            )}
          </div>
        </>
      )}

      <div className="rounded-lg border border-line">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted hover:text-ink"
          onClick={() => setImages(!images)}
        >
          <ImageIcon size={14} />
          Images{media.length > 0 ? ` (${media.length} attached)` : " — attach one"}
          <ChevronDown size={13} className={clsx("ml-auto transition", images && "rotate-180")} />
        </button>

        {media.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pb-2">
            {media.map((m, i) => (
              <figure key={m.id} className="w-36">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/media/${m.id}`} alt={m.alt} className="rounded-md border border-line" />
                <figcaption className="mt-1 line-clamp-2 text-[10px] leading-tight text-muted">
                  {media.length > 1 ? `Slide ${i + 1} · ` : ""}
                  {m.alt}
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        {images && (
          <div className="space-y-3 border-t border-line p-3">
            {platform === "x" && <p className="text-xs text-muted">X attaches the image(s) to the first post of the thread.</p>}
            <CardForm draftId={draftId} platform={platform} />
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <ActionButton action={attachOgImageAction.bind(null, draftId)} className="btn-secondary text-xs" pendingText="Fetching…">
                Use the source preview image
              </ActionButton>
              <span className="text-[11px] text-muted">Pulls the article&apos;s own preview image — keep the source named in the post.</span>
            </div>
            {imageGenEnabled && (
              <details className="border-t border-line pt-3">
                <summary className="cursor-pointer text-xs text-muted">
                  <Sparkles size={12} className="mr-1 inline" />
                  Generate a decorative image (paid, off by default)
                </summary>
                <div className="mt-2">
                  <ActionForm action={generateImageAction} submit="Generate & attach" pendingText="Generating… (10-60s)" resetOnSuccess>
                    <input type="hidden" name="draftId" value={draftId} />
                    <textarea name="prompt" rows={2} className="input" placeholder="e.g. minimal dark illustration of an eval loop, no text" />
                    <p className="mt-1 text-[11px] text-muted">Decorative only. Disclose it in the post — readers punish silent synthetic art.</p>
                  </ActionForm>
                </div>
              </details>
            )}
            {media.length > 0 && (
              <div className="border-t border-line pt-3">
                <ActionButton action={detachMediaAction.bind(null, draftId)} className="btn-ghost text-xs" confirm="Remove image?" pendingText="Removing…">
                  Remove image
                </ActionButton>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-line bg-paper p-3">
        {paused && <p className="mb-2 text-xs text-warn">{name} publishing is paused in Settings, so scheduled posts will wait.</p>}
        <div className="flex flex-wrap gap-2">
          {suggestion ? (
            <button
              type="button"
              className="btn-primary"
              disabled={pending || tooLong}
              onClick={() => run("schedule", () => approveAndScheduleAction(draftId, parts, "at", suggestion.local))}
            >
              <CalendarClock size={15} />
              {busy === "schedule" ? "Scheduling…" : `${approved ? "Schedule" : "Approve & schedule"} · ${suggestion.label}`}
            </button>
          ) : (
            <span className="text-xs text-muted">No free slot in your {name} posting windows in the next 2 weeks. Pick a time below.</span>
          )}
          <button
            type="button"
            className="btn-secondary"
            disabled={pending || tooLong}
            onClick={() => run("now", () => approveAndScheduleAction(draftId, parts, "now"))}
          >
            <Send size={14} /> {busy === "now" ? "Posting…" : "Post now"}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setMore(!more)}>
            More <ChevronDown size={14} className={clsx("transition", more && "rotate-180")} />
          </button>
        </div>
        {suggestion && !more && <p className="mt-2 text-xs text-muted">{suggestion.reason}</p>}
        {cost != null && (
          <p className="mt-2 text-[11px] text-muted">
            Est. X cost: <strong>${cost.toFixed(3)}</strong> ({parts.length} post{parts.length > 1 ? "s" : ""}
            {media.length > 0 ? `, ${Math.min(media.length, 4)} image${media.length > 1 ? "s" : ""}` : ""}
            {linkInReply && /https?:\/\//.test(parts.join(" ")) ? ", link moved to reply" : ""}) · X bills per created post; media ~$0.005 each.
          </p>
        )}

        {more && (
          <div className="mt-3 space-y-3 border-t border-line pt-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <input type="datetime-local" className="input w-auto" min={minLocal} value={pick} onChange={(e) => setPick(e.target.value)} />
              <button type="button" className="btn-secondary" disabled={pending || tooLong} onClick={() => run("pick", () => approveAndScheduleAction(draftId, parts, "at", pick))}>
                {busy === "pick" ? "Scheduling…" : `${approved ? "Schedule" : "Approve & schedule"} at this time`}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {!approved && (
                <button type="button" className="btn-ghost" disabled={pending || tooLong} onClick={() => run("approve", () => approveAndScheduleAction(draftId, parts, "approve_only"))}>
                  <Check size={14} /> Approve only (schedule later)
                </button>
              )}
              {dirty && (
                <button type="button" className="btn-ghost" disabled={pending} onClick={() => run("save", () => saveRevisionDirectAction(draftId, parts))}>
                  Save edits without approving
                </button>
              )}
              <button type="button" className="btn-ghost text-bad" disabled={pending} onClick={() => run("reject", () => rejectAction(draftId))}>
                Reject this {name} version
              </button>
            </div>
          </div>
        )}
        {dirty && <p className="mt-2 text-xs text-muted">You have unsaved edits. Approving will save them first.</p>}
        {busy?.startsWith("rewrite") || busy === "angle" || busy?.startsWith("format") || busy === "carousel" ? (
          <p className="mt-2 text-xs text-muted">{busy === "carousel" ? "Rendering slides takes about a minute…" : "Rewriting takes 10–30 seconds…"}</p>
        ) : null}
        <ResultMessage result={result} />
      </div>
    </div>
  );
}

/** Card image editor: renders server-side via satori and binds the PNG to a new revision. */
function CardForm({ draftId, platform }: { draftId: string; platform: "x" | "linkedin" }) {
  const [template, setTemplate] = useState("stat");
  return (
    <ActionForm action={attachCardAction} className="space-y-2" submit="Render & attach card" pendingText="Rendering…" resetOnSuccess>
      <input type="hidden" name="draftId" value={draftId} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <select name="template" className="input" value={template} onChange={(e) => setTemplate(e.target.value)}>
          <option value="stat">Number card</option>
          <option value="quote">Quote card</option>
          <option value="bullets">List card</option>
          <option value="hook">Headline card</option>
        </select>
        <select name="size" className="input" defaultValue={platform === "x" ? "wide" : "tall"}>
          <option value="tall">Portrait 1080×1350</option>
          <option value="wide">Wide 1200×630</option>
        </select>
        <input name="kicker" className="input" placeholder="Kicker (optional)" />
      </div>
      {template === "stat" && (
        <div className="grid grid-cols-2 gap-2">
          <input name="stat" className="input" placeholder="The number, e.g. $0.014" />
          <input name="label" className="input" placeholder="What it means (one line)" />
        </div>
      )}
      {template === "quote" && (
        <>
          <textarea name="quote" rows={3} className="input" placeholder="The quote — verbatim, under 40 words" />
          <input name="attribution" className="input" placeholder="Who said it (name, role)" />
        </>
      )}
      {template === "bullets" && (
        <>
          <input name="title" className="input" placeholder="Title" />
          <textarea name="bullets" rows={3} className="input" placeholder={"One bullet per line (2–4 lines)"} />
        </>
      )}
      {template === "hook" && (
        <>
          <input name="title" className="input" placeholder="Headline" />
          <input name="body" className="input" placeholder="One supporting line (optional)" />
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        <input name="source" className="input" placeholder="Footer credit (e.g. via arxiv.org)" />
        <input name="alt" className="input" placeholder="Alt text (auto if blank)" />
      </div>
    </ActionForm>
  );
}
