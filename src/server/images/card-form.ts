/**
 * Form → CardSpec parsing for the workbench image panel. Pure (no DB), so it is easy to test.
 */
import { z } from "zod";
import { DomainError } from "../drafts/service";
import { SIZE_LI, SIZE_X, type CardSize, type CardSpec } from "./render";

export function sizeFor(choice: string): CardSize {
  return choice === "tall" ? SIZE_LI : SIZE_X;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function specFromForm(fd: FormData): CardSpec {
  const get = (k: string) => clip(String(fd.get(k) ?? "").trim(), 600);
  const template = z.enum(["stat", "quote", "bullets", "hook"]).parse(get("template"));
  const spec: CardSpec = {
    template,
    kicker: clip(get("kicker"), 60) || undefined,
    stat: clip(get("stat"), 24) || undefined,
    label: clip(get("label"), 220) || undefined,
    quote: clip(get("quote"), 380) || undefined,
    attribution: clip(get("attribution"), 80) || undefined,
    title: clip(get("title"), 140) || undefined,
    body: clip(get("body"), 400) || undefined,
    bullets: get("bullets")
      .split("\n")
      .map((s) => clip(s.trim(), 180))
      .filter(Boolean)
      .slice(0, 4),
    source: clip(get("source"), 80) || undefined,
  };
  if (template === "stat" && !spec.stat) throw new DomainError("Add the number for the stat card.");
  if (template === "quote" && !spec.quote) throw new DomainError("Add the quote text.");
  if (template === "bullets" && (spec.bullets?.length ?? 0) < 2) throw new DomainError("Add at least two bullet lines.");
  if (template === "hook" && !spec.title) throw new DomainError("Add the headline.");
  return spec;
}

/** A card the drafting model suggested. All fields are nullable strings from the output schema. */
export interface CardSuggestion {
  template: string;
  kicker?: string | null;
  stat?: string | null;
  label?: string | null;
  quote?: string | null;
  attribution?: string | null;
  title?: string | null;
  body?: string | null;
  bullets?: string[] | null;
  source?: string | null;
}

/**
 * Validate an auto-suggested card. Returns null (never throws) when the suggestion is
 * incomplete or malformed — a missing card must never block a draft.
 */
export function cardSpecFromSuggestion(input: CardSuggestion): CardSpec | null {
  const parsed = z.enum(["stat", "quote", "bullets", "hook"]).safeParse(input.template);
  if (!parsed.success) return null;
  const t = (s: string | null | undefined, max: number) => {
    const v = (s ?? "").trim();
    return v ? clip(v, max) : undefined;
  };
  const spec: CardSpec = {
    template: parsed.data,
    kicker: t(input.kicker, 60),
    stat: t(input.stat, 24),
    label: t(input.label, 220),
    quote: t(input.quote, 380),
    attribution: t(input.attribution, 80),
    title: t(input.title, 140),
    body: t(input.body, 400),
    bullets: (input.bullets ?? []).map((b) => t(b, 180)).filter((b): b is string => Boolean(b)).slice(0, 4),
    source: t(input.source, 80),
  };
  if (spec.template === "stat" && !spec.stat) return null;
  if (spec.template === "quote" && !spec.quote) return null;
  if (spec.template === "bullets" && (spec.bullets?.length ?? 0) < 2) return null;
  if (spec.template === "hook" && !spec.title) return null;
  return spec;
}
