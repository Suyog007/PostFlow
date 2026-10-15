import { slotSchema, type Slot } from "./settings";

/** Slots are edited as lines: "linkedin Mon-Fri 09:15" */
const DAY = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export function parseSlots(text: string): Slot[] {
  const out: Slot[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim().toLowerCase();
    if (!line) continue;
    const m = line.match(/^(x|linkedin)\s+([a-z,\-]+)\s+(\d{1,2}:\d{2})$/);
    if (!m) throw new Error(`Cannot read "${raw.trim()}". Use e.g. "linkedin mon-fri 09:15" or "x daily 19:30".`);
    const days: number[] = [];
    if (m[2] === "daily") days.push(1, 2, 3, 4, 5, 6, 7);
    else
      for (const part of m[2].split(",")) {
        const [a, b] = part.split("-");
        const i = DAY.indexOf(a.slice(0, 3));
        const j = b ? DAY.indexOf(b.slice(0, 3)) : i;
        if (i < 0 || j < 0) throw new Error(`Unknown day in "${raw.trim()}".`);
        for (let d = i; ; d = (d + 1) % 7) {
          days.push(d + 1);
          if (d === j) break;
        }
      }
    out.push(slotSchema.parse({ platform: m[1], days: [...new Set(days)], time: m[3].padStart(5, "0") }));
  }
  if (!out.length) throw new Error("Add at least one slot.");
  return out;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Inverse of parseSlots, for the settings textarea. */
export function formatSlots(slots: Slot[]): string {
  return slots
    .map((s) => {
      const d = [...s.days].sort((a, b) => a - b);
      const daily = d.length === 7;
      const range = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
      const days = daily ? "daily" : range && d.length > 1 ? `${DAY_NAMES[d[0] - 1]}-${DAY_NAMES[d[d.length - 1] - 1]}` : d.map((x) => DAY_NAMES[x - 1]).join(",");
      return `${s.platform} ${days} ${s.time}`;
    })
    .join("\n");
}
