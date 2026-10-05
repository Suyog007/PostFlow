/**
 * Dev helper: render every card template to .data/card-preview/ so you can eyeball them.
 * Usage: npx tsx scripts/card-preview.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { renderCardPng, SIZE_LI, SIZE_X, type CardSpec } from "../src/server/images/render";

const specs: [string, CardSpec, "wide" | "tall"][] = [
  [
    "stat-x",
    {
      template: "stat",
      kicker: "Inference prices",
      stat: "$0.014",
      label: "per million tokens for a frontier-class model — roughly 40× cheaper than 2023",
      source: "via arxiv.org",
    },
    "wide",
  ],
  [
    "quote-li",
    {
      template: "quote",
      kicker: "From the paper",
      quote: "The bottleneck is no longer compute; it's the evaluation loop nobody wants to fund.",
      attribution: "D. Sculley, CEO, Kaggle",
      source: "via practicaldatascience.org",
    },
    "tall",
  ],
  [
    "bullets-li",
    {
      template: "bullets",
      kicker: "Three things to watch",
      title: "Agent frameworks are consolidating fast",
      bullets: [
        "MCP is becoming the USB-C of tool calling — every big lab shipped support this quarter.",
        "The moat is moving from model weights to evals and distribution.",
        "Small teams with tight feedback loops are outshipping larger ones.",
      ],
      source: "via simonwillison.net",
    },
    "tall",
  ],
  [
    "cover-li",
    {
      template: "cover",
      kicker: "What if?",
      title: "What if evals were as easy to run as unit tests?",
      body: "Six ways the AI stack changes when testing stops being a research project.",
      source: "linkedin.com",
    },
    "tall",
  ],
  [
    "slide-li",
    {
      template: "slide",
      kicker: "What changed",
      title: "Tool calling went from bespoke glue to a protocol",
      body: "One interface now describes tools, resources and prompts.\nSwapping providers is a config change, not a rewrite.",
      source: "linkedin.com",
      index: 3,
      total: 8,
    },
    "tall",
  ],
  [
    "hook-x",
    {
      template: "hook",
      kicker: "Worth your time",
      title: "The eval loop is the product now",
      body: "Models are commodities; the team that can measure what's broken ships faster than the team that can't.",
      source: "via hamel.dev",
    },
    "wide",
  ],
];

const dir = path.join(process.cwd(), ".data", "card-preview");
await fs.mkdir(dir, { recursive: true });
for (const [name, spec, size] of specs) {
  const png = await renderCardPng(spec, size === "wide" ? SIZE_X : SIZE_LI);
  await fs.writeFile(path.join(dir, `${name}.png`), png.data);
  console.log(`${name}.png  ${png.width}×${png.height}  ${(png.data.length / 1024).toFixed(0)} KB`);
}
console.log(`\nWrote ${specs.length} cards to ${dir}`);
