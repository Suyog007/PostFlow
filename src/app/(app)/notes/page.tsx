import { DateTime } from "luxon";
import { desc, eq } from "drizzle-orm";
import { requireActiveUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { getSettings } from "@/server/settings";
import { addNoteAction, deleteNoteAction } from "@/app/actions";
import { Flash } from "../flash";

const PILLAR_LABEL: Record<string, string> = { own_work: "Something I built or did", learning: "Something I learned", local: "My local scene", news: "A take on news" };

export default async function NotesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await requireActiveUser();
  const s = await getSettings();
  const notes = await db().select().from(schema.notes).where(eq(schema.notes.userId, user.id)).orderBy(desc(schema.notes.createdAt)).limit(100);
  const used = new Set((await db().select({ n: schema.posts.noteId }).from(schema.posts).where(eq(schema.posts.userId, user.id))).map((r) => r.n));
  return (
    <div className="max-w-3xl">
      <Flash ok={sp.ok} error={sp.error} />
      <h1 className="display mb-2 text-[34px]">Ideas</h1>
      <p className="mb-5 max-w-2xl text-[15px] text-[var(--muted)]">
        Tell PostFlow about your own work, in rough words. It turns your ideas into posts, using only what you wrote here. Numbers and small details make the best posts.
      </p>
      <form action={addNoteAction} className="card mb-8 space-y-3 p-5">
        <textarea name="text" rows={4} required aria-label="Your idea" placeholder="e.g. Moved our invoice PDF generation to a background job. Page load dropped from 4s to 1.2s. Mistake: I first cached it, which hid the real problem." className="textarea" />
        <div className="flex flex-wrap items-center gap-3">
          <select name="pillar" aria-label="What the idea is about" className="input h-10 max-w-full" style={{ width: "auto" }} defaultValue="own_work">
            {["own_work", "learning", "local"].map((p) => <option key={p} value={p}>{p === "local" ? `Something happening in ${s.profile.region || "my city"} (an event, meetup or local company)` : PILLAR_LABEL[p]}</option>)}
          </select>
          <button className="btn-primary h-10 px-5">Save idea</button>
        </div>
        <p className="hint">Posts about you only ever come from ideas you add here, or send to the Telegram bot.</p>
      </form>
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id} className="card flex items-start gap-3 p-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="prose-post">{n.text}</p>
              <p className="mt-1 text-xs text-muted">{PILLAR_LABEL[n.pillar]} · {DateTime.fromJSDate(n.createdAt, { zone: s.timezone }).toFormat("d LLL")} · {used.has(n.id) ? "turned into a post" : "waiting for a free posting time"}</p>
            </div>
            <form action={deleteNoteAction}><input type="hidden" name="id" value={n.id} /><button className="btn btn-ghost">Delete</button></form>
          </li>
        ))}
        {!notes.length && <li className="text-[14px] text-[var(--muted)]">No ideas yet. Until you add some, PostFlow writes about the news in your field.</li>}
      </ul>
    </div>
  );
}
