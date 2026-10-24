import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { withUser } from "@/server/context";
import { ensurePostImage, verifyCard } from "@/server/post-images";

export const runtime = "nodejs";
// Drawing a new picture can take a little while the first time.
export const maxDuration = 60;

/** The post's picture, behind a signed link. Drawn on first request if it does not exist yet. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyCard(id, url.searchParams.get("v"), url.searchParams.get("s"))) return new Response("Not found", { status: 404 });
  const post = await db().query.posts.findFirst({ where: eq(schema.posts.id, id) });
  if (!post) return new Response("Not found", { status: 404 });
  const img = await withUser(post.userId, () => ensurePostImage(post));
  if (!img) return new Response("No picture for this post", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(img.data), { headers: { "Content-Type": img.mime, "Cache-Control": "public, max-age=31536000, immutable" } });
}
