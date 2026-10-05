/**
 * OG image fallback: fetch the article's own social preview image on demand,
 * normalize it (≤1600px, JPEG), and store it as media. Opt-in per draft.
 */
import { JSDOM, VirtualConsole } from "jsdom";
import sharp from "sharp";
import { isPublicHttpUrl } from "../discovery/collect";

export interface OgImage {
  data: Buffer;
  mime: string;
  alt: string;
  sourceUrl: string;
  site: string;
  width: number;
  height: number;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) PostFlow/0.1 Safari/537.36";

export async function fetchOgImage(pageUrl: string): Promise<OgImage> {
  if (!isPublicHttpUrl(pageUrl)) throw new Error("That page cannot be fetched.");
  const res = await fetch(pageUrl, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(20_000), redirect: "follow" });
  if (!res.ok) throw new Error(`The page returned HTTP ${res.status}.`);

  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM((await res.text()).slice(0, 800_000), { url: pageUrl, virtualConsole });
  const doc = dom.window.document;
  const meta = (selector: string) => doc.querySelector(selector)?.getAttribute("content")?.trim() || null;
  const imageUrlRaw =
    meta('meta[property="og:image"]') ??
    meta('meta[name="og:image"]') ??
    meta('meta[name="twitter:image"]') ??
    meta('meta[property="twitter:image"]');
  if (!imageUrlRaw) throw new Error("That page has no preview image.");

  let imageUrl: string;
  try {
    imageUrl = new URL(imageUrlRaw, pageUrl).toString();
  } catch {
    throw new Error("That page's preview image has an invalid URL.");
  }
  if (!isPublicHttpUrl(imageUrl)) throw new Error("That page's preview image cannot be fetched.");

  const imgRes = await fetch(imageUrl, { headers: { "User-Agent": UA, Accept: "image/*" }, signal: AbortSignal.timeout(20_000), redirect: "follow" });
  if (!imgRes.ok) throw new Error(`The preview image returned HTTP ${imgRes.status}.`);
  const type = imgRes.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new Error("The preview image is not an image.");
  const buf = Buffer.from(await imgRes.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("The preview image is too large.");

  const metaInfo = await sharp(buf).metadata();
  if (!metaInfo.width || metaInfo.width < 200) throw new Error("The preview image is too small to use.");
  const data = await sharp(buf)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 86 })
    .toBuffer();

  const alt = meta('meta[property="og:image:alt"]') ?? meta('meta[name="twitter:image:alt"]') ?? doc.title ?? "";
  const site = meta('meta[property="og:site_name"]') ?? dom.window.location.hostname;
  const outMeta = await sharp(data).metadata();
  return { data, mime: "image/jpeg", alt: alt.slice(0, 500), sourceUrl: pageUrl, site, width: outMeta.width ?? 0, height: outMeta.height ?? 0 };
}
