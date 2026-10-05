/**
 * Intake extraction: turn a URL or pasted text into clean article material.
 * URLs go through Readability (same engine family Firefox reader mode uses);
 * pasted text is taken as-is. Everything is bounded and best-effort.
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { isPublicHttpUrl } from "../discovery/collect";

export interface ExtractedArticle {
  url: string | null;
  title: string;
  byline: string | null;
  siteName: string | null;
  text: string;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) PostFlow/0.1 Safari/537.36";
const MAX_HTML_BYTES = 800_000;
const MAX_TEXT_CHARS = 20_000;

function cleanText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

export class IntakeError extends Error {}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export function looksLikeUrl(input: string): boolean {
  const t = input.trim();
  return /^https?:\/\/\S+$/i.test(t) || /^www\.\S+\.\S+$/i.test(t);
}

/** Fetch a public URL and extract the readable article. Throws IntakeError with a friendly message. */
export async function extractFromUrl(input: string): Promise<ExtractedArticle> {
  const url = normalizeUrl(input);
  if (!isPublicHttpUrl(url)) throw new IntakeError("That URL cannot be fetched (only public http(s) pages).");

  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
    if (!res.ok) throw new IntakeError(`The page returned HTTP ${res.status}. Try pasting the text instead.`);
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("text")) throw new IntakeError("That link is not a web page. Try pasting the text instead.");
    const buf = await res.arrayBuffer();
    html = new TextDecoder("utf-8").decode(buf.slice(0, MAX_HTML_BYTES));
  } catch (err) {
    if (err instanceof IntakeError) throw err;
    throw new IntakeError(`Could not load that page (${(err as Error).message.slice(0, 120)}). Try pasting the text instead.`);
  }

  const virtualConsole = new VirtualConsole(); // stay quiet on malformed pages
  const dom = new JSDOM(html, { url, virtualConsole });
  let parsed: { title?: string | null; byline?: string | null; siteName?: string | null; textContent?: string | null } | null = null;
  try {
    parsed = new Readability(dom.window.document).parse();
  } catch {
    parsed = null;
  }
  const text = cleanText(parsed?.textContent ?? "");
  if (text.length < 400) {
    // Reader extraction failed or the page is mostly app-shell; fall back to a plain strip.
    const fallback = cleanText(dom.window.document.body?.textContent ?? "");
    if (fallback.length < 400) throw new IntakeError("Could not read meaningful text from that page. Try pasting the text instead.");
    return {
      url,
      title: (parsed?.title ?? dom.window.document.title ?? "").trim().slice(0, 200) || url,
      byline: parsed?.byline ?? null,
      siteName: parsed?.siteName ?? new URL(url).hostname,
      text: fallback,
    };
  }
  return {
    url,
    title: (parsed?.title ?? "").trim().slice(0, 200) || url,
    byline: parsed?.byline ?? null,
    siteName: parsed?.siteName ?? new URL(url).hostname,
    text,
  };
}

/** Pasted text: title is the first line when it looks like one. */
export function extractFromText(input: string): ExtractedArticle {
  const text = cleanText(input);
  if (text.length < 80) throw new IntakeError("That text is too short to work with. Paste at least a paragraph.");
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  const title = firstLine.length >= 8 && firstLine.length <= 140 && !/[.!?]$/.test(firstLine) ? firstLine : text.slice(0, 90);
  return { url: null, title, byline: null, siteName: null, text };
}

export function extractIntake(input: string): Promise<ExtractedArticle> | ExtractedArticle {
  return looksLikeUrl(input) ? extractFromUrl(input) : extractFromText(input);
}
