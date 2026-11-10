"use client";

// Posting times as rows of day toggles and a time picker. It submits the same
// "linkedin mon,tue 09:15" lines the server already parses, so nothing changes on save.

import { useState } from "react";
import { Icon, PlatformGlyph } from "@/components/ui";

type Platform = "linkedin" | "x";
export type SlotRow = { platform: Platform; days: number[]; time: string };

const DAYS = [
  { n: 1, short: "M", name: "Monday", key: "mon" },
  { n: 2, short: "T", name: "Tuesday", key: "tue" },
  { n: 3, short: "W", name: "Wednesday", key: "wed" },
  { n: 4, short: "T", name: "Thursday", key: "thu" },
  { n: 5, short: "F", name: "Friday", key: "fri" },
  { n: 6, short: "S", name: "Saturday", key: "sat" },
  { n: 7, short: "S", name: "Sunday", key: "sun" },
];
const PRESETS = [
  { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { label: "Every day", days: [1, 2, 3, 4, 5, 6, 7] },
];

const line = (r: SlotRow) => `${r.platform} ${[...r.days].sort((a, b) => a - b).map((d) => DAYS[d - 1].key).join(",")} ${r.time}`;

/** "Weekdays at 09:15", "Mon, Wed, Fri at 12:00": the row read back in words. */
function summary(r: SlotRow) {
  const d = [...r.days].sort((a, b) => a - b).join(",");
  const days = d === "1,2,3,4,5,6,7" ? "Every day" : d === "1,2,3,4,5" ? "Weekdays" : d === "6,7" ? "Weekends" : r.days.length ? [...r.days].sort((a, b) => a - b).map((n) => DAYS[n - 1].name.slice(0, 3)).join(", ") : "No days picked";
  return `${days} at ${r.time}`;
}

export function ScheduleEditor({ initial, showX, timezone }: { initial: SlotRow[]; showX: boolean; timezone: string }) {
  // Slots for a platform this plan cannot use stay saved, untouched and out of sight.
  const [hidden] = useState(() => initial.filter((r) => !showX && r.platform === "x"));
  const [rows, setRows] = useState<SlotRow[]>(() => initial.filter((r) => showX || r.platform !== "x"));
  const update = (i: number, patch: Partial<SlotRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const toggle = (i: number, n: number) => update(i, { days: rows[i].days.includes(n) ? rows[i].days.filter((d) => d !== n) : [...rows[i].days, n] });
  const empty = rows.some((r) => !r.days.length);
  const perWeek = rows.reduce((sum, r) => sum + r.days.length, 0);

  return (
    <div className="space-y-3">
      <input type="hidden" name="slots" value={[...new Set([...rows, ...hidden].filter((r) => r.days.length).map(line))].join("\n")} />
      {rows.length ? (
        <ul className="divide-y divide-line rounded-[6px] border border-[var(--line)]">
          {rows.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-3 p-3">
              {showX ? (
                <select aria-label="Platform" value={r.platform} onChange={(e) => update(i, { platform: e.target.value as Platform })} className="input h-9" style={{ width: "auto" }}>
                  <option value="linkedin">LinkedIn</option>
                  <option value="x">X</option>
                </select>
              ) : (
                <span className="flex h-9 items-center" title="LinkedIn"><PlatformGlyph platform="linkedin" size={18} /></span>
              )}
              <div role="group" aria-label="Days" className="flex gap-1">
                {DAYS.map((d) => {
                  const on = r.days.includes(d.n);
                  return (
                    <button
                      key={d.n}
                      type="button"
                      aria-pressed={on}
                      aria-label={d.name}
                      title={d.name}
                      onClick={() => toggle(i, d.n)}
                      className={`h-10 w-10 rounded-full border text-[13px] font-semibold transition-colors ${on ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]" : "border-[var(--line-strong)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--ink)]"}`}
                    >
                      {d.short}
                    </button>
                  );
                })}
              </div>
              <input type="time" aria-label="Time" required value={r.time} onChange={(e) => update(i, { time: e.target.value || r.time })} className="input h-9 tnum" style={{ width: 132 }} />
              <span className="min-w-0 flex-1 text-[13px] text-[var(--muted)]">{summary(r)}</span>
              <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="btn btn-ghost h-9 w-9" style={{ padding: 0 }} aria-label={`Remove ${summary(r)}`} title="Remove">
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-[6px] border border-dashed border-[var(--line-strong)] p-4 text-[14px] text-[var(--muted)]">No posting times yet. Add one below.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setRows((rs) => [...rs, { platform: "linkedin", days: [1, 2, 3, 4, 5], time: "09:00" }])} className="btn-secondary">
          <Icon name="create" size={16} /> Add a time
        </button>
        {rows.length > 0 && (
          <span className="flex items-center gap-3 text-[13px] text-[var(--muted)]">
            <span>Set every time to</span>
            {PRESETS.map((p) => (
              <button key={p.label} type="button" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, days: p.days })))} className="underline underline-offset-2 hover:text-[var(--ink)]">
                {p.label}
              </button>
            ))}
          </span>
        )}
      </div>

      <p className="text-[13px] text-[var(--muted)]">
        {perWeek} {perWeek === 1 ? "post" : "posts"} a week at most, in {timezone.replace(/_/g, " ")}. If no story is worth posting, a time can stay empty.
        {empty && <span className="text-[var(--warn)]"> A time with no days picked is not saved.</span>}
      </p>
    </div>
  );
}
