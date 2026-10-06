import { and, eq, inArray, sql } from "drizzle-orm";
import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { Nav } from "@/components/nav";
import { logoutAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await requireUser();
  const [counts] = await db()
    .select({
      drafts: sql<number>`count(*) filter (where ${schema.drafts.status} = 'awaiting_approval')`,
      problems: sql<number>`count(*) filter (where ${schema.drafts.status} = 'failed')`,
    })
    .from(schema.drafts)
    .where(and(eq(schema.drafts.userId, userId), inArray(schema.drafts.status, ["awaiting_approval", "failed"])));
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col md:flex-row">
      <aside className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-paper/90 px-4 py-3 backdrop-blur md:h-screen md:w-56 md:flex-col md:items-stretch md:justify-start md:border-r md:border-b-0 md:py-6">
        <div className="hidden px-3 md:block">
          <div className="text-lg font-semibold tracking-tight">PostFlow</div>
          <div className="text-xs text-muted">Discover · Draft · Decide</div>
        </div>
        <Nav counts={{ drafts: Number(counts?.drafts ?? 0), problems: Number(counts?.problems ?? 0) }} />
        <form action={logoutAction} className="md:mt-auto md:px-3">
          <button className="btn-ghost px-0 text-xs">Sign out</button>
        </form>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-10">{children}</main>
    </div>
  );
}
