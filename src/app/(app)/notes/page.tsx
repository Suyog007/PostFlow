import { DateTime } from "luxon";
import { desc, eq } from "drizzle-orm";
import { requireActiveUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { getSettings } from "@/server/settings";
import { addNoteAction, deleteNoteAction } from "@/app/actions";
import { Flash } from "../flash";

const PILLAR_LABEL: Record<string, string> = { own_work: "Something I built or did", learning: "Something I learned", local: "My local tech scene", news: "A take on news" };

export default async function NotesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await requireActiveUser();
  const s = await getSettings();
  const notes = await db().select().from(schema.notes).where(eq(schema.notes.userId, user.id)).orderBy(desc(schema.notes.createdAt)).limit(100);
  const used = new Set((await db().select({ n: schema.posts.noteId }).from(schema.posts).where(eq(schema.posts.userId, user.id))).map((r) => r.n));
  return (
    <div className="max-w-3xl">
      <Flash ok={sp.ok} error={sp.error} />
      <h1 className="mb-1 text-lg font-semibold">Notes</h1>
      <p className="mb-4 text-sm text-muted">
        This is how your real work becomes posts. Jot what you built, learned or noticed, in rough words. The writer may only claim what is in your note, so details (numbers, tools, what went wrong) make better posts.
        You can also message these to your Telegram bot.
      </p>
      <form action={addNoteAction} className="card mb-8 space-y-3 p-4">
        <textarea name="text" rows={4} required placeholder="e.g. Moved our invoice PDF generation to a background job. Page load dropped from 4s to 1.2s. Mistake: I first cached it, which hid the real problem." className="textarea" />
        <div className="flex items-center gap-3">
          <select name="pillar" className="input w-auto" defaultValue="own_work">
            {["own_work", "learning", "local"].map((p) => <option key={p} value={p}>{p === "local" && s.profile.region ? `${s.profile.region} tech scene` : PILLAR_LABEL[p]}</option>)}
          </select>
          <button className="btn-primary">Save note</button>
        </div>
      </form>
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id} className="card flex items-start gap-3 p-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="prose-post">{n.text}</p>
              <p className="mt-1 text-xs text-muted">{PILLAR_LABEL[n.pillar]} · {DateTime.fromJSDate(n.createdAt, { zone: s.timezone }).toFormat("d LLL")} · via {n.via} · {used.has(n.id) ? "used" : "waiting for a slot"}</p>
            </div>
            <form action={deleteNoteAction}><input type="hidden" name="id" value={n.id} /><button className="btn-ghost">Delete</button></form>
          </li>
        ))}
        {!notes.length && <li className="text-sm text-muted">No notes yet. Without them, autopilot can only post news takes and evergreen explainers.</li>}
      </ul>
    </div>
  );
}
