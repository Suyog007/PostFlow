/**
 * Card renderer: satori (SVG) + sharp (PNG). Dark, text-only templates — fast, free,
 * and honest (no AI-looking art on news posts).
 *
 * Sizes: X 1200×630 (wide), LinkedIn/multi-image 1080×1350 (tall), carousel slides 1080×1350.
 */
import fs from "node:fs/promises";
import path from "node:path";
import satori from "satori";
import sharp from "sharp";

export type CardTemplate = "stat" | "quote" | "bullets" | "cover" | "slide" | "hook";

export interface CardSpec {
  template: CardTemplate;
  kicker?: string;
  stat?: string;
  label?: string;
  quote?: string;
  attribution?: string;
  title?: string;
  body?: string;
  bullets?: string[];
  source?: string;
  index?: number;
  total?: number;
}

export interface CardSize {
  width: number;
  height: number;
}

export const SIZE_X: CardSize = { width: 1200, height: 630 };
export const SIZE_LI: CardSize = { width: 1080, height: 1350 };

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const WEIGHTS = [400, 600, 700, 800] as const;
type FontWeight = (typeof WEIGHTS)[number];

let fontsPromise: Promise<{ name: string; data: Buffer; weight: FontWeight; style: "normal" }[]> | null = null;

async function loadFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all(
      WEIGHTS.map(async (weight) => ({
        name: "Inter",
        data: await fs.readFile(path.join(FONT_DIR, `inter-${weight}.woff`)),
        weight,
        style: "normal" as const,
      })),
    ).catch((err) => {
      fontsPromise = null;
      throw new Error(`Card fonts are missing in assets/fonts (${(err as Error).message}).`);
    });
  }
  return fontsPromise;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const INK = "#F4F6FA";
const MUTED = "#98A2B3";
const FAINT = "#6B7484";
const ACCENT = "#37D399";
const BG = "#0B0E14";

interface Ctx {
  s: (px: number) => number;
}

function Frame({ children, footer, ctx }: { children: React.ReactNode[]; footer?: React.ReactNode; ctx: Ctx }) {
  const { s } = ctx;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        background: BG,
        padding: s(64),
        fontFamily: "Inter",
        color: INK,
      }}
    >
      <div style={{ display: "flex", flexGrow: 1, flexDirection: "column", justifyContent: "center", gap: s(24) }}>{children}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", fontSize: s(22), color: FAINT, gap: s(16) }}>
        {footer ?? <div style={{ display: "flex" }} />}
      </div>
    </div>
  );
}

function Kicker({ text, ctx }: { text: string; ctx: Ctx }) {
  return (
    <div style={{ display: "flex", fontSize: ctx.s(24), fontWeight: 700, letterSpacing: ctx.s(2.5), textTransform: "uppercase", color: ACCENT }}>
      {text}
    </div>
  );
}

function cardBody(spec: CardSpec, ctx: Ctx) {
  const { s } = ctx;
  switch (spec.template) {
    case "stat":
      return (
        <Frame ctx={ctx} footer={<div style={{ display: "flex" }}>{spec.source ?? ""}</div>}>
          {spec.kicker ? <Kicker ctx={ctx} text={spec.kicker} /> : null}
          <div style={{ display: "flex", fontSize: s(112), fontWeight: 800, lineHeight: 1.04, color: INK, letterSpacing: s(-2) }}>{spec.stat ?? ""}</div>
          <div style={{ display: "flex", fontSize: s(38), fontWeight: 500, color: "#D6DCE8", lineHeight: 1.3, maxWidth: "94%" }}>{spec.label ?? ""}</div>
        </Frame>
      );
    case "quote":
      return (
        <Frame ctx={ctx} footer={<div style={{ display: "flex" }}>{spec.source ?? ""}</div>}>
          {spec.kicker ? <Kicker ctx={ctx} text={spec.kicker} /> : null}
          <div style={{ display: "flex", fontSize: s(44), fontWeight: 600, lineHeight: 1.35, color: INK, maxWidth: "96%" }}>“{spec.quote ?? ""}”</div>
          {spec.attribution ? <div style={{ display: "flex", fontSize: s(28), fontWeight: 500, color: MUTED }}>— {spec.attribution}</div> : null}
        </Frame>
      );
    case "bullets":
      return (
        <Frame ctx={ctx} footer={<div style={{ display: "flex" }}>{spec.source ?? ""}</div>}>
          {spec.kicker ? <Kicker ctx={ctx} text={spec.kicker} /> : null}
          {spec.title ? <div style={{ display: "flex", fontSize: s(46), fontWeight: 700, lineHeight: 1.2 }}>{spec.title}</div> : null}
          <div style={{ display: "flex", flexDirection: "column", gap: s(22), marginTop: s(8) }}>
            {(spec.bullets ?? []).slice(0, 4).map((b, i) => (
              <div key={i} style={{ display: "flex", gap: s(20), alignItems: "flex-start" }}>
                <div style={{ display: "flex", fontSize: s(30), fontWeight: 800, color: ACCENT, width: s(48) }}>{String(i + 1).padStart(2, "0")}</div>
                <div style={{ display: "flex", fontSize: s(32), lineHeight: 1.35, color: "#DCE2EC", maxWidth: "88%" }}>{b}</div>
              </div>
            ))}
          </div>
        </Frame>
      );
    case "cover":
      return (
        <Frame ctx={ctx} footer={<div style={{ display: "flex" }}>{spec.source ?? ""}</div>}>
          {spec.kicker ? <Kicker ctx={ctx} text={spec.kicker} /> : null}
          <div style={{ display: "flex", fontSize: s(76), fontWeight: 800, lineHeight: 1.12, letterSpacing: s(-1.5), maxWidth: "96%" }}>{spec.title ?? ""}</div>
          {spec.body ? <div style={{ display: "flex", fontSize: s(32), color: MUTED, lineHeight: 1.35, maxWidth: "90%" }}>{spec.body}</div> : null}
        </Frame>
      );
    case "slide":
      return (
        <Frame
          ctx={ctx}
          footer={
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
              <div style={{ display: "flex" }}>{spec.source ?? ""}</div>
              {spec.index && spec.total ? <div style={{ display: "flex" }}>{spec.index} / {spec.total}</div> : null}
            </div>
          }
        >
          {spec.kicker ? <Kicker ctx={ctx} text={spec.kicker} /> : null}
          <div style={{ display: "flex", fontSize: s(58), fontWeight: 700, lineHeight: 1.18, maxWidth: "96%" }}>{spec.title ?? ""}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: s(14), marginTop: s(6) }}>
            {(spec.body ?? "").split("\n").filter(Boolean).map((line, i) => (
              <div key={i} style={{ display: "flex", fontSize: s(34), lineHeight: 1.4, color: "#C9D2E0", maxWidth: "94%" }}>
                {line}
              </div>
            ))}
          </div>
        </Frame>
      );
    case "hook":
    default:
      return (
        <Frame ctx={ctx} footer={<div style={{ display: "flex" }}>{spec.source ?? ""}</div>}>
          {spec.kicker ? <Kicker ctx={ctx} text={spec.kicker} /> : null}
          <div style={{ display: "flex", fontSize: s(58), fontWeight: 700, lineHeight: 1.2, maxWidth: "96%" }}>{spec.title ?? ""}</div>
          {spec.body ? <div style={{ display: "flex", fontSize: s(32), color: "#C9D2E0", lineHeight: 1.4, maxWidth: "92%" }}>{spec.body}</div> : null}
        </Frame>
      );
  }
}

export async function renderCardPng(spec: CardSpec, size: CardSize): Promise<{ data: Buffer; width: number; height: number }> {
  const fonts = await loadFonts();
  const scale = size.height >= 1100 ? 1 : 0.72;
  const ctx: Ctx = { s: (px: number) => Math.round(px * scale) };
  const svg = await satori(cardBody(spec, ctx) as React.ReactElement, {
    width: size.width,
    height: size.height,
    fonts,
  });
  const data = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  return { data, width: size.width, height: size.height };
}

/** Sensible alt text per template, editable in the UI. */
export function cardAlt(spec: CardSpec): string {
  switch (spec.template) {
    case "stat":
      return `${spec.stat ?? ""} — ${spec.label ?? spec.kicker ?? ""}`.trim();
    case "quote":
      return `Quote: “${spec.quote ?? ""}”${spec.attribution ? ` — ${spec.attribution}` : ""}`;
    case "bullets":
      return `${spec.title ?? spec.kicker ?? "Key points"}: ${(spec.bullets ?? []).join("; ")}`;
    case "slide":
    case "cover":
      return `${spec.title ?? ""}${spec.body ? ` — ${spec.body.replace(/\n/g, " ")}` : ""}`;
    default:
      return `${spec.title ?? ""}${spec.body ? ` — ${spec.body}` : ""}`;
  }
}
