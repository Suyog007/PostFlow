import { cookies } from "next/headers";
import { cleanSource, SOURCE_COOKIE } from "@/lib/attribution";

/** Where the person signing up came from, as remembered by the SourceTracker cookie. */
export async function visitSource(): Promise<string | null> {
  try {
    const raw = (await cookies()).get(SOURCE_COOKIE)?.value;
    return cleanSource(raw ? decodeURIComponent(raw) : null);
  } catch {
    return null;
  }
}
