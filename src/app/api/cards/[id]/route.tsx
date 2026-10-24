import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { withUser } from "@/server/context";
import { getSettings } from "@/server/settings";
import { cardContent, verifyCard, type CardContent } from "@/server/cards";
import { log } from "@/server/log";

export const runtime = "nodejs";

const W = 1200;
const H = 675;

// Neutral dark card; one accent per kind of post. Colours follow the app's tokens.
const TONES: Record<CardContent["tone"], { accent: string; soft: string }> = {
  news: { accent: "#6f9bff", soft: "rgba(111,155,255,.14)" },
  alert: { accent: "#e5a24a", soft: "rgba(229,162,74,.16)" },
  lesson: { accent: "#4cc27c", soft: "rgba(76,194,124,.15)" },
  work: { accent: "#e8ebf0", soft: "rgba(232,235,240,.12)" },
};

let fonts: Promise<{ name: string; data: Buffer; weight: 500 | 800; style: "normal" }[]> | null = null;
function loadFonts() {
  fonts ??= Promise.all([
    readFile(join(process.cwd(), "assets/fonts/inter-500.woff")).then((data) => ({ name: "Inter", data, weight: 500 as const, style: "normal" as const })),
    readFile(join(process.cwd(), "assets/fonts/inter-800.woff")).then((data) => ({ name: "Inter", data, weight: 800 as const, style: "normal" as const })),
  ]);
  return fonts;
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "•"
  );
}

/** Big hooks get smaller type so they always fit on the card. */
const hookSize = (n: number) => (n <= 55 ? 76 : n <= 90 ? 64 : n <= 120 ? 54 : 46);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyCard(id, url.searchParams.get("v"), url.searchParams.get("s"))) return new Response("Not found", { status: 404 });
  const post = await db().query.posts.findFirst({ where: eq(schema.posts.id, id) });
  if (!post) return new Response("Not found", { status: 404 });

  try {
    const s = await withUser(post.userId, () => getSettings());
    const c = cardContent(post, s.profile);
    const tone = TONES[c.tone];
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", background: "#0c0e12", color: "#e8ebf0", fontFamily: "Inter", position: "relative" }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 10, background: tone.accent, display: "flex" }} />
          <div style={{ display: "flex" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "8px 18px", borderRadius: 999, background: tone.soft, color: tone.accent, fontSize: 24, fontWeight: 800, letterSpacing: 0.5 }}>{c.tag}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
            <div style={{ display: "flex", fontSize: hookSize(c.hook.length), fontWeight: 800, lineHeight: 1.12, letterSpacing: -1.2 }}>{c.hook}</div>
            {c.sub ? <div style={{ display: "flex", fontSize: 30, fontWeight: 500, lineHeight: 1.4, color: "#9aa4b2", maxWidth: 1000 }}>{c.sub}</div> : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 60, height: 60, borderRadius: 999, background: tone.accent, color: "#0c0e12", fontSize: 24, fontWeight: 800 }}>{initials(c.name)}</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 26, fontWeight: 800 }}>{c.name || " "}</div>
              {c.role ? <div style={{ display: "flex", fontSize: 21, fontWeight: 500, color: "#6f7a8a" }}>{c.role.slice(0, 80)}</div> : null}
            </div>
          </div>
        </div>
      ),
      { width: W, height: H, fonts: await loadFonts(), headers: { "Cache-Control": "public, max-age=31536000, immutable" } },
    );
  } catch (err) {
    log.error("card_render_failed", { postId: id, error: (err as Error).message });
    return new Response("Could not draw the card", { status: 500 });
  }
}
