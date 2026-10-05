/**
 * LinkedIn carousel: script (LLM) → slide PNGs (renderer) → media rows → bound to a revision.
 * Published via the MultiImage flow; LinkedIn's own 2026 studies show this as the top format.
 */
import type { MediaRef } from "../db/schema";
import { cardAlt, renderCardPng, SIZE_LI, type CardSpec } from "./render";
import { saveMedia } from "./store";
import type { CarouselScript } from "../llm/prompts";

/** Renders slides 1..N: slide 1 becomes the cover (promise), the rest carry one atom each. */
export async function renderCarousel(userId: string, script: CarouselScript, source?: string): Promise<MediaRef[]> {
  const slides = script.slides.slice(0, 10);
  const total = slides.length;
  const refs: MediaRef[] = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const spec: CardSpec =
      i === 0
        ? { template: "cover", kicker: s.kicker, title: s.title, body: s.body.replace(/\n/g, " "), source: source ?? "" }
        : { template: "slide", kicker: s.kicker, title: s.title, body: s.body, source: source ?? "", index: i + 1, total };
    const png = await renderCardPng(spec, SIZE_LI);
    const row = await saveMedia({
      userId,
      kind: "slide",
      data: png.data,
      mime: "image/png",
      width: png.width,
      height: png.height,
      alt: cardAlt(spec),
      meta: { template: spec.template, slide: i + 1, total, ...(i === 0 ? { cover: true } : {}) } satisfies Record<string, unknown>,
    });
    refs.push({ mediaId: row.id, role: "slide", alt: row.alt });
  }
  return refs;
}
