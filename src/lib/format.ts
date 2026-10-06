import { DateTime } from "luxon";

export function fmtDateTime(d: Date | string | null | undefined, tz: string, fmt = "ccc d LLL, h:mm a") {
  if (!d) return "—";
  return DateTime.fromJSDate(new Date(d), { zone: tz }).toFormat(fmt);
}

export function fmtRelative(d: Date | string | null | undefined, tz: string) {
  if (!d) return "unknown date";
  const dt = DateTime.fromJSDate(new Date(d), { zone: tz });
  const hours = Math.abs(DateTime.now().diff(dt, "hours").hours);
  if (hours < 36) return dt.toRelative() ?? "";
  return dt.toFormat("d LLL yyyy");
}

/** Value for <input type="datetime-local"> in the user's timezone. */
export function toLocalInput(d: Date, tz: string) {
  return DateTime.fromJSDate(d, { zone: tz }).toFormat("yyyy-LL-dd'T'HH:mm");
}

export function platformName(p: string) {
  return p === "x" ? "X" : "LinkedIn";
}

/** Human label for a revision's engagement format. */
export function formatLabel(f: string | null | undefined) {
  const map: Record<string, string> = {
    post: "Post",
    thread: "Thread",
    carousel: "Carousel",
    whatif: "What if…",
    contrarian: "Contrarian",
    takeaways: "3 takeaways",
    quote_take: "Quote + take",
    question: "Question close",
  };
  return map[f ?? "post"] ?? f ?? "Post";
}

export function firstLine(parts: string[] | null | undefined, max = 90) {
  const t = (parts?.[0] ?? "").split("\n").find((l) => l.trim()) ?? "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
