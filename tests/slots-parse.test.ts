import { describe, expect, it } from "vitest";
import { formatSlots, parseSlots } from "../src/server/slots-parse";

describe("parseSlots", () => {
  it("parses ranges, lists and daily", () => {
    const s = parseSlots("linkedin mon-fri 09:15\nx daily 19:30\nx sat,sun 8:00");
    expect(s[0]).toEqual({ platform: "linkedin", days: [1, 2, 3, 4, 5], time: "09:15" });
    expect(s[1].days).toHaveLength(7);
    expect(s[2]).toEqual({ platform: "x", days: [6, 7], time: "08:00" });
  });
  it("round-trips", () => {
    const text = "linkedin Mon-Fri 09:15\nx daily 19:30";
    expect(formatSlots(parseSlots(text))).toBe(text);
  });
  it("rejects nonsense with a helpful message", () => {
    expect(() => parseSlots("tiktok daily 09:00")).toThrow(/Cannot read/);
    expect(() => parseSlots("x daily 25:00")).toThrow();
  });
});
