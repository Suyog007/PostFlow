/**
 * End-to-end smoke test against the real database and LLM.
 * Spends a small amount of LLM budget (≈4 research-tier calls).
 *
 * Usage: npx tsx scripts/smoke.ts
 *
 * Does by hand what the UI does by click:
 *   1. intake a pasted article -> atoms
 *   2. generate an X draft + a LinkedIn draft from two atoms
 *   3. render a card image and attach it to the X draft
 *   4. build a LinkedIn carousel (script + slides) for the LinkedIn draft
 */
import { loadDotEnv } from "./load-env";

loadDotEnv();

import { ensureOwner } from "../src/server/users";
import { createIntake } from "../src/server/intake/service";
import { generateDrafts, makeCarousel } from "../src/server/content";
import { addRevision } from "../src/server/drafts/service";
import { saveMedia } from "../src/server/images/store";
import { renderCardPng, SIZE_X } from "../src/server/images/render";
import { db, schema } from "../src/server/db/client";
import { eq } from "drizzle-orm";

const PASTED = `Op-ed: The quiet shift in AI pricing

For two years the story was capability. This year the story is unit economics. In January a frontier-class
model cost about $9 per million output tokens from the major labs; by October the same measured capability
is available for roughly $0.60, and open-weight models are within a few points on most public evals.

The strategic consequence is underrated. When inference is this cheap, the bottleneck moves to evaluation
and distribution. Teams that can measure what is broken ship faster than teams with a better model. One
engineering lead at a mid-size startup put it bluntly: "We stopped shopping for models and started shopping
for evals. That was the whole unlock."

What does not get cheaper: trust. Hallucinated citations, silent regressions after a provider update, and
evaluation debt all resist the price curve. Budgets will follow whichever layer turns a cheaper token into
a trustworthy outcome.`;

async function main() {
  const owner = await ensureOwner();
  console.log(`owner: ${owner.email}\n`);

  console.log("1) intake pasted text…");
  const intake = await createIntake(owner.id, PASTED);
  console.log(`   intake ${intake.id} — ${intake.atoms.length} atoms`);
  for (const a of intake.atoms) console.log(`   [${a.kind}] ${a.text.slice(0, 90)}${a.text.length > 90 ? "…" : ""}`);

  const atomIds = intake.atoms.slice(0, 2).map((a) => a.id);
  console.log("\n2) generate drafts from first two atoms…");
  const results = await generateDrafts(owner.id, { intakeId: intake.id, atomIds }, ["x", "linkedin"], "why cheap tokens make evals the new moat");
  const drafts = results.filter((r) => r.draftId);
  for (const r of results) console.log(`   ${r.platform}: ${r.draftId ?? `skipped — ${r.skipped ?? r.error}`}`);
  if (drafts.length === 0) throw new Error("no drafts were generated — check LLM config");

  const x = drafts.find((r) => r.platform === "x");
  const li = drafts.find((r) => r.platform === "linkedin");

  if (x?.draftId) {
    console.log("\n3) render a card and attach it to the X draft…");
    const card = await renderCardPng(
      {
        template: "stat",
        kicker: "Inference prices",
        stat: "$0.60",
        label: "per million output tokens for frontier-class capability — down from ~$9 in January",
        source: "via your pasted op-ed",
      },
      SIZE_X,
    );
    const media = await saveMedia({
      userId: owner.id,
      kind: "card",
      data: card.data,
      width: card.width,
      height: card.height,
      alt: "Card reading: $0.60 per million output tokens for frontier-class capability, down from ~$9 in January",
    });
    const rev = await db().query.draftRevisions.findFirst({ where: eq(schema.draftRevisions.draftId, x.draftId) });
    await addRevision(owner.id, x.draftId, rev!.parts, "user", "attach card", undefined, {
      format: rev!.format ?? "post",
      media: [{ mediaId: media.id, role: "image", alt: media.alt ?? "" }],
    });
    console.log(`   attached ${card.width}×${card.height} PNG (${(card.data.length / 1024).toFixed(0)} KB) — media ${media.id}`);
  }

  if (li?.draftId) {
    console.log("\n4) build a LinkedIn carousel for the LinkedIn draft…");
    const rev = await makeCarousel(owner.id, li.draftId);
    const slides = (rev.media ?? []) as { mediaId: string }[];
    console.log(`   revision ${rev.revisionNo}, format ${rev.format}, ${slides.length} slide images`);
  }

  console.log("\nDone. Open http://localhost:3000/drafts to review the drafts;");
  console.log("the drafts await YOUR approval — nothing will be posted automatically.");
  process.exit(0);
}

main().catch((err) => {
  console.error("smoke failed:", err);
  process.exit(1);
});
