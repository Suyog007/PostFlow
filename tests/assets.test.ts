import { describe, expect, it } from "vitest";
import { qualityIssues, textSimilarity } from "@/server/drafts/validator";
import { specFromForm, sizeFor } from "@/server/images/card-form";
import { xCostEstimate } from "@/lib/x-cost";
import { extractFromText, looksLikeUrl, IntakeError } from "@/server/intake/extract";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

describe("quality validator", () => {
  it("flags banned slop phrases", () => {
    const issues = qualityIssues(["We are excited to share this groundbreaking tool."], "linkedin");
    const codes = issues.map((i) => i.message);
    expect(codes.some((m) => m.includes("groundbreaking"))).toBe(true);
    expect(codes.some((m) => m.includes("excited to share"))).toBe(true);
  });

  it("flags more than one question", () => {
    const issues = qualityIssues(["Did you see this? What do you think?"], "x");
    expect(issues.some((i) => i.code === "questions")).toBe(true);
  });

  it("does not flag a single genuine question", () => {
    const issues = qualityIssues(["The eval loop is the bottleneck. What would make it 10× faster?"], "linkedin");
    expect(issues.some((i) => i.code === "questions")).toBe(false);
  });

  it("flags long quotes and hashtag pileups", () => {
    const longQuote = `“${Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ")}”`;
    const issues = qualityIssues([`${longQuote} #ai #news #tech`], "linkedin");
    expect(issues.some((i) => i.code === "quote_length")).toBe(true);
    expect(issues.some((i) => i.code === "hashtags")).toBe(true);
  });

  it("adds a cost note for links on X only", () => {
    const onX = qualityIssues(["Read this https://example.com/a"], "x");
    const onLi = qualityIssues(["Read this https://example.com/a"], "linkedin");
    expect(onX.some((i) => i.code === "link_cost")).toBe(true);
    expect(onLi.some((i) => i.code === "link_cost")).toBe(false);
  });

  it("warns on near-duplicates against recent approved posts", () => {
    const post = "Small teams with tight eval loops are outshipping larger teams that cannot measure what is broken.";
    const issues = qualityIssues([post], "x", [`${post} Honestly.`]);
    expect(issues.some((i) => i.code === "duplicate")).toBe(true);
  });

  it("similarity is bounded and sane", () => {
    expect(textSimilarity("alpha beta gamma delta epsilon", "alpha beta gamma delta epsilon")).toBe(1);
    expect(textSimilarity("alpha beta gamma delta epsilon", "completely unrelated words here now")).toBe(0);
  });
});

describe("card form parsing", () => {
  it("parses a stat card and derives the size", () => {
    const spec = specFromForm(fd({ draftId: "d", template: "stat", stat: "$0.014", label: "per million tokens" }));
    expect(spec.template).toBe("stat");
    expect(spec.stat).toBe("$0.014");
    expect(sizeFor("wide").width).toBe(1200);
    expect(sizeFor("tall").height).toBe(1350);
  });

  it("rejects a stat card without a number", () => {
    expect(() => specFromForm(fd({ template: "stat", label: "x" }))).toThrow(/number/i);
  });

  it("requires at least two bullets for list cards", () => {
    expect(() => specFromForm(fd({ template: "bullets", title: "T", bullets: "just one" }))).toThrow(/two bullet/i);
    const ok = specFromForm(fd({ template: "bullets", title: "T", bullets: "one\ntwo\nthree" }));
    expect(ok.bullets).toHaveLength(3);
  });

  it("rejects unknown templates", () => {
    expect(() => specFromForm(fd({ template: "meme" }))).toThrow();
  });
});

describe("x cost estimate", () => {
  it("bills text posts at $0.015 each", () => {
    expect(xCostEstimate(["a", "b"], 0, false)).toBe(0.03);
  });
  it("bills any post with a URL at $0.20", () => {
    expect(xCostEstimate(["see https://a.com"], 0, false)).toBe(0.2);
  });
  it("with link-in-reply the main posts stay cheap and the reply carries the link", () => {
    expect(xCostEstimate(["see https://a.com for more"], 0, true)).toBe(0.215);
  });
  it("adds $0.005 per media (max 4)", () => {
    expect(xCostEstimate(["hello"], 2, false)).toBe(0.025);
    expect(xCostEstimate(["hello"], 10, false)).toBe(0.035);
  });
});

describe("intake extraction (pasted text)", () => {
  it("detects URLs", () => {
    expect(looksLikeUrl("https://example.com/a")).toBe(true);
    expect(looksLikeUrl("www.example.com/a")).toBe(true);
    expect(looksLikeUrl("just some text")).toBe(false);
  });

  it("rejects very short pastes", () => {
    expect(() => extractFromText("too short")).toThrow(IntakeError);
  });

  it("uses a title-like first line as the title", () => {
    const text = "Agents are eating SaaS from the bottom\n\nMore text follows here that is definitely long enough to pass the minimum length requirement of the extractor.";
    const out = extractFromText(text);
    expect(out.title).toBe("Agents are eating SaaS from the bottom");
    expect(out.url).toBeNull();
    expect(out.text.length).toBeGreaterThan(80);
  });
});
