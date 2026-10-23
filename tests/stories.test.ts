import { describe, expect, it } from "vitest";
import { coverage, sameStory, storyIndex } from "../src/server/stories";

// Real headlines from one day of feeds.
const DAY = [
  ["PHP2Shell exploit bypasses protections designed to stop remote code execution", "register"],
  ["PHP2Shell puts dozens of UK government services out of service", "register"],
  ["Hackers got a four-day head start on epic PHP2Shell vulnerability", "ars"],
  ["AI found a critical PHP flaw. The bigger failure began in 2024.", "newstack"],
  ["PHP Armageddon: OpenAI, Google's Wiz find ancient holes, panicking the internet", "techcrunch"],
  ["Cloudflare deploys protections against php2shell vulnerability", "cloudflare"],
  ["Today's PHP Security Release, and How We're Strengthening PHP Security", "simonw"],
  ["OpenAI launches Decisions API for fast, low-cost decisions", "openai"],
  ["OpenAI's GPT-5.6 Sol tops coding benchmarks", "decoder"],
  ["Google's Agent Compute Engine gives each Gemini agent its own microVM", "google"],
  ["Canva launches Canva Craft image model", "techcrunch"],
  ["Recursive launches Flint, a laptop coding model", "decoder"],
  ["Skipped monorepo deployments no longer count against limits", "vercel"],
  ["Show HN: Omnara, open-source alternative to managed agents", "hn"],
  ["Microsoft says ConnectWise breach let spies into 2,250 tenants", "register"],
  ["Chinese hackers spied on thousands of companies after breaching ConnectWise", "techcrunch"],
  ["DeepSeek open-sources the inference engine behind its API", "decoder"],
  ["Hugging Face: specializing a tokenizer cut inference cost by 77%", "hf"],
  ["Switch 2 security takes a hit as hackers unlock homebrew access", "ars"],
  ["Nvidia brings cash to its wafer supply chain", "register"],
  ["LiteLLM supply chain attack hoovers up passwords", "register"],
  ["React Compiler 2.0 is out", "react"],
  ["Next.js 17 beta adds partial prerendering by default", "nextjs"],
  ["Stripe adds stablecoin payouts in 40 countries", "stripe"],
  ["Supabase launches branching for everyone", "supabase"],
].map(([title, src], i) => ({ id: String(i), title, sourceId: src }));

describe("same story across outlets", () => {
  it("counts the outlets covering a big story, and not for a one-off", () => {
    const c = coverage(DAY);
    expect(c.get("0")).toBeGreaterThanOrEqual(5); // PHP2Shell: Ars, New Stack, TechCrunch, Cloudflare, Simon Willison...
    expect(c.get("15")).toBe(1); // ConnectWise: one other outlet
    expect(c.get("12")).toBe(0); // monorepo deployments: only Vercel
  });

  it("treats articles about the same event as one story, but not every OpenAI or 'launches' headline", () => {
    const keys = storyIndex(DAY);
    expect(sameStory(keys, DAY[0].title, DAY[6].title)).toBe(true);
    expect(sameStory(keys, DAY[14].title, DAY[15].title)).toBe(true);
    expect(sameStory(keys, DAY[7].title, DAY[8].title)).toBe(false); // both OpenAI, different stories
    expect(sameStory(keys, DAY[10].title, DAY[11].title)).toBe(false); // both "launches"
    expect(sameStory(keys, DAY[11].title, DAY[8].title)).toBe(false); // both about coding models
  });
});
