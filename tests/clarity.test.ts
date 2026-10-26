import { describe, expect, it } from "vitest";
import { gate } from "../src/server/generate";
import { writerSystem, REVIEWER_SYSTEM } from "../src/server/prompts";
import { settingsSchema } from "../src/server/settings";
import { GOOD_REVIEW } from "./helpers";

const m = { kind: "evergreen", pillar: "learning", source: "Topic: ISR", label: "ISR", topic: "ISR", firstPerson: false } as Parameters<typeof gate>[2];

describe("clear enough for someone new to the topic", () => {
  it("holds back a post the reviewer finds hard to follow, saying why", () => {
    const v = gate({ ...GOOD_REVIEW, clarity: 5, issues: ["The acronym ISR is never explained."] } as Parameters<typeof gate>[0], [], m);
    expect(v.approved).toBe(false);
    expect(v.reasons[0]).toBe("Hard to follow (5/10): The acronym ISR is never explained.");
    expect(gate({ ...GOOD_REVIEW } as Parameters<typeof gate>[0], [], m).approved).toBe(true);
  });

  it("the writer is told to spell out acronyms and explain, and the reviewer to score clarity", () => {
    const w = writerSystem(settingsSchema.parse({}), "linkedin");
    expect(w).toMatch(/Spell out every acronym/);
    expect(w).toMatch(/Never a list of instructions/);
    expect(REVIEWER_SYSTEM).toMatch(/clarity \(0-10\)/);
  });
});
