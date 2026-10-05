/**
 * Media store: PNG/JPEG files under .data/media/<userId>/, one row per file in `media`.
 * Revisions reference rows by id (see MediaRef); publish-time upload reads the file here.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/client";

export type MediaRow = typeof schema.media.$inferSelect;

export function mediaRoot() {
  return path.join(process.cwd(), ".data", "media");
}

function extensionFor(mime: string) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

export interface SaveMediaInput {
  userId: string;
  kind: "card" | "slide" | "og" | "generated";
  data: Buffer;
  mime?: string;
  width: number;
  height: number;
  alt?: string;
  meta?: Record<string, unknown>;
}

export async function saveMedia(input: SaveMediaInput): Promise<MediaRow> {
  const id = crypto.randomUUID();
  const mime = input.mime ?? "image/png";
  const filePath = path.join(input.userId, `${id}.${extensionFor(mime)}`);
  const abs = path.join(mediaRoot(), filePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, input.data);
  const [row] = await db()
    .insert(schema.media)
    .values({
      id,
      userId: input.userId,
      kind: input.kind,
      filePath,
      mime,
      width: input.width,
      height: input.height,
      bytes: input.data.length,
      sha256: crypto.createHash("sha256").update(input.data).digest("hex"),
      alt: input.alt ?? "",
      meta: input.meta ?? {},
    })
    .returning();
  return row;
}

export async function getMediaForUser(userId: string, mediaId: string) {
  return db().query.media.findFirst({ where: and(eq(schema.media.id, mediaId), eq(schema.media.userId, userId)) });
}

/** Read media files for a list of revisions' refs. Missing files are skipped (never crash a publish). */
export async function readMediaData(row: MediaRow): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(mediaRoot(), row.filePath));
  } catch {
    return null;
  }
}

export async function loadMediaRefs(userId: string, refs: { mediaId: string }[]) {
  if (refs.length === 0) return [];
  const ids = refs.map((r) => r.mediaId);
  const rows = await db().query.media.findMany({ where: eq(schema.media.userId, userId) });
  const wanted = rows.filter((r) => ids.includes(r.id));
  const out: { row: MediaRow; data: Buffer }[] = [];
  for (const ref of refs) {
    const row = wanted.find((r) => r.id === ref.mediaId);
    if (!row) continue;
    const data = await readMediaData(row);
    if (data) out.push({ row, data });
  }
  return out;
}
