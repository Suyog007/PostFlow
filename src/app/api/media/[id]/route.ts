import { NextResponse } from "next/server";
import { currentUserId } from "@/server/auth";
import { getMediaForUser, readMediaData } from "@/server/images/store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  const row = await getMediaForUser(userId, (await params).id);
  if (!row) return new NextResponse("Not found", { status: 404 });
  const data = await readMediaData(row);
  if (!data) return new NextResponse("File missing", { status: 404 });
  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": row.mime, "Cache-Control": "private, max-age=3600" },
  });
}
