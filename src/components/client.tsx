"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import type { ActionResult } from "@/app/actions";

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function ResultMessage({ result }: { result: ActionResult | null | undefined }) {
  if (!result || (!result.error && !result.message)) return null;
  return (
    <p className={clsx("mt-2 text-sm", result.error ? "text-bad" : "text-good")} role="status">
      {result.error ?? result.message}
    </p>
  );
}

/** A button that runs a server action (bound with arguments) and shows the result inline. */
export function ActionButton({
  action,
  children,
  className = "btn-secondary",
  confirm,
  pendingText,
  title,
}: {
  action: () => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
  pendingText?: string;
  title?: string;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        title={title}
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirm && !armed) {
            setArmed(true);
            setTimeout(() => setArmed(false), 4000);
            return;
          }
          setArmed(false);
          start(async () => {
            const r = await action();
            setResult(r);
            router.refresh();
          });
        }}
      >
        {pending ? pendingText ?? "Working…" : armed ? confirm : children}
      </button>
      <ResultMessage result={result} />
    </span>
  );
}

/** Wrap a <form> bound to a server action with useActionState; shows errors/messages. */
export function ActionForm({
  action,
  children,
  className,
  submit,
  submitClass = "btn-primary",
  pendingText = "Working…",
  resetOnSuccess,
}: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  submit?: React.ReactNode;
  submitClass?: string;
  pendingText?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [key, setKey] = useState(0);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      if (resetOnSuccess) setKey((k) => k + 1);
    }
  }, [state, router, resetOnSuccess]);
  return (
    <form key={key} action={formAction} className={className}>
      <fieldset disabled={pending} className="contents">
        {children}
        {submit && (
          <div className="mt-3">
            <button className={submitClass} type="submit">
              {pending ? pendingText : submit}
            </button>
          </div>
        )}
      </fieldset>
      <ResultMessage result={state} />
    </form>
  );
}

export function SubmitButton({ children, className = "btn-primary", name, value }: { children: React.ReactNode; className?: string; name?: string; value?: string }) {
  return (
    <button className={className} type="submit" name={name} value={value}>
      {children}
    </button>
  );
}

/** Refresh the page periodically while a background job is running. */
export function AutoRefresh({ everyMs = 5000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}

// ---------------------------------------------------------------------------
// Draft editor with live, platform-aware character counts
// ---------------------------------------------------------------------------

const URL_RE = /https?:\/\/[^\s]+/g;
function xLength(text: string) {
  let len = 0;
  const rest = text.replace(URL_RE, () => {
    len += 23;
    return "";
  });
  for (const ch of rest) {
    const cp = ch.codePointAt(0)!;
    len += (cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247)) ? 1 : 2;
  }
  return len;
}

export function PartsEditor({ platform, initial, draftId, disabled, action }: {
  platform: "x" | "linkedin";
  initial: string[];
  draftId: string;
  disabled?: boolean;
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
}) {
  const [parts, setParts] = useState(initial);
  const [state, formAction, pending] = useActionState(action, null);
  const router = useRouter();
  useEffect(() => {
    setParts(initial);
  }, [initial.join("\u0000")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  const limit = platform === "x" ? 280 : 3000;
  const len = (t: string) => (platform === "x" ? xLength(t) : [...t].length);
  const dirty = parts.join("\u0000") !== initial.join("\u0000");

  return (
    <form action={formAction}>
      <input type="hidden" name="draftId" value={draftId} />
      <fieldset disabled={disabled || pending} className="space-y-3">
        {parts.map((p, i) => {
          const n = len(p);
          return (
            <div key={i} className="relative">
              {parts.length > 1 && <div className="mb-1 text-xs text-muted">Post {i + 1} of {parts.length}</div>}
              <textarea
                name="part"
                value={p}
                onChange={(e) => setParts(parts.map((x, j) => (j === i ? e.target.value : x)))}
                rows={platform === "x" ? 4 : 12}
                className="input prose-post font-[inherit] text-[15px]"
              />
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className={clsx(n > limit ? "font-semibold text-bad" : n > limit * 0.9 ? "text-warn" : "text-muted")}>
                  {n.toLocaleString()} / {limit.toLocaleString()}
                  {platform === "x" ? " (links count as 23)" : ""}
                </span>
                {platform === "x" && parts.length > 1 && (
                  <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => setParts(parts.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" type="submit" disabled={!dirty}>
            {pending ? "Saving…" : "Save edits"}
          </button>
          {platform === "x" && parts.length < 15 && (
            <button type="button" className="btn-ghost" onClick={() => setParts([...parts, ""])}>
              + Add post to thread
            </button>
          )}
          {dirty && (
            <button type="button" className="btn-ghost" onClick={() => setParts(initial)}>
              Discard changes
            </button>
          )}
        </div>
      </fieldset>
      <ResultMessage result={state} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Posting windows editor (settings)
// ---------------------------------------------------------------------------

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function WindowsEditor({ initial }: { initial: { days: number[]; start: string; end: string }[] }) {
  const [wins, setWins] = useState(initial);
  return (
    <div className="space-y-2">
      <input type="hidden" name="windows" value={JSON.stringify(wins)} />
      {wins.map((w, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
          <div className="flex gap-1">
            {DAYS.map((d, di) => {
              const on = w.days.includes(di + 1);
              return (
                <button
                  key={d}
                  type="button"
                  className={clsx("rounded-md px-2 py-1 text-xs", on ? "bg-accent text-white" : "bg-paper text-muted")}
                  onClick={() =>
                    setWins(wins.map((x, j) => (j === i ? { ...x, days: on ? x.days.filter((n) => n !== di + 1) : [...x.days, di + 1].sort() } : x)))
                  }
                >
                  {d}
                </button>
              );
            })}
          </div>
          <input type="time" className="input w-auto" value={w.start} onChange={(e) => setWins(wins.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
          <span className="text-muted">to</span>
          <input type="time" className="input w-auto" value={w.end} onChange={(e) => setWins(wins.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
          <button type="button" className="btn-ghost text-xs" onClick={() => setWins(wins.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn-ghost text-sm" onClick={() => setWins([...wins, { days: [1, 2, 3, 4, 5], start: "09:00", end: "11:00" }])}>
        + Add window
      </button>
    </div>
  );
}

/** Small inline prompt for a custom angle or instruction. */
export function InlinePrompt({
  label,
  placeholder,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  onSubmit: (value: string) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();
  if (!open)
    return (
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  return (
    <div className="w-full">
      <div className="flex gap-2">
        <input className="input" autoFocus value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} />
        <button
          type="button"
          className="btn-primary"
          disabled={pending || value.trim().length < 3}
          onClick={() =>
            start(async () => {
              const r = await onSubmit(value);
              setResult(r);
              if (r.ok) {
                setOpen(false);
                setValue("");
              }
              router.refresh();
            })
          }
        >
          {pending ? "Working…" : "Go"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <ResultMessage result={result} />
    </div>
  );
}

/** Clamp long text with a "Show full post" toggle. */
export function ExpandableText({ children, lines = 8 }: { children: React.ReactNode; lines?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className={clsx(!open && "overflow-hidden")} style={open ? undefined : { maxHeight: `${lines * 1.55}em` }}>
        {children}
      </div>
      <button type="button" className="mt-1 text-xs text-accent hover:underline" onClick={() => setOpen(!open)}>
        {open ? "Show less" : "Show full post"}
      </button>
    </div>
  );
}
