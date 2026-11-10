import { DateTime } from "luxon";
import Link from "next/link";
import { getSettings } from "@/server/settings";
import { requireActiveUser } from "@/server/auth";
import { entitlementOf } from "@/server/billing/plans";
import { recentRequests } from "@/server/requests";
import { createPostAction, addTipAction, retryAnywayAction } from "@/app/actions";
import { Flash } from "../flash";

export const dynamic = "force-dynamic";

export default async function CreatePage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await requireActiveUser();
  const links = entitlementOf(user).features.links;
  const showX = entitlementOf(user).features.x;
  const s = await getSettings();
  const reqs = await recentRequests(8);
  return (
    <div className="max-w-3xl space-y-8">
      <Flash ok={sp.ok} error={sp.error} />
      <section>
        <h1 className="display mb-2 text-[34px]">Write a post</h1>
        <p className="mb-5 max-w-2xl text-[15px] text-[var(--muted)]">Type an idea or paste a link to an article. PostFlow writes the post, checks it, and puts it in your posts for you to approve.</p>
        <form action={createPostAction} className="card space-y-4 p-5 text-[14px]">
          <textarea name="text" rows={5} required aria-label="Your idea or link" placeholder={"An idea: Most clients ask me the same three questions before signing. Here they are.\nOr a link: https://example.com/article"} className="textarea text-[15px]" />
          <div className="flex flex-wrap items-center gap-3">
            <select name="mode" aria-label="When it goes out" className="input h-10" style={{ width: "auto" }} defaultValue="schedule">
              <option value="schedule">At my next posting time</option>
              <option value="soon">In about 20 minutes</option>
              <option value="draft">Keep as a draft</option>
            </select>
            {showX ? (
              <>
                <label className="flex items-center gap-2"><input type="checkbox" name="p_linkedin" defaultChecked /> LinkedIn</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="p_x" defaultChecked /> X</label>
              </>
            ) : (
              <input type="hidden" name="p_linkedin" value="on" />
            )}
            <button className="btn-primary h-10 px-5">Write it</button>
          </div>
          <details>
            <summary className="cursor-pointer text-[13px] text-[var(--muted)] hover:text-[var(--ink)]">More options</summary>
            <div className="mt-3 space-y-2">
              <label className="flex items-center gap-2"><input type="checkbox" name="research" /> It&apos;s news I heard about: look it up before writing</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="force" /> Write it even if the story looks weak</label>
              {links ? (
                <label className="flex items-center gap-2"><input type="checkbox" name="own" /> The link is my own article: write it as me and include the link</label>
              ) : (
                <p className="text-[12px] text-[var(--muted)]">Writing from a link or your own articles is part of <Link href="/billing" className="underline">Pro</Link>.</p>
              )}
            </div>
          </details>
          {s.ownDomains.length > 0 && <p className="text-xs text-muted">Links to {s.ownDomains.join(", ")} are treated as your own articles automatically.</p>}
        </form>
      </section>

      <section>
        <h2 className="mb-1 text-[17px] font-semibold">Saw a story? Send it in</h2>
        <p className="mb-3 text-[14px] text-[var(--muted)]">PostFlow writes about it later, but only once other news sites confirm it.</p>
        <form action={addTipAction} className="card flex gap-2 p-3">
          <input name="url" type="url" required placeholder="https://" className="input" />
          <button className="btn-secondary">Save tip</button>
        </form>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted">Recent requests</h2>
        <ul className="space-y-2 text-sm">
          {reqs.map((r) => (
            <li key={r.id} className="card p-3">
              <p className="line-clamp-2 break-words">{r.input}</p>
              <p className="mt-1 text-xs text-muted">{DateTime.fromJSDate(r.createdAt, { zone: s.timezone }).toFormat("d LLL HH:mm")} · {r.status === "skipped" ? "not worth a post" : r.status}{r.error ? `: ${r.error}` : ""}</p>
              {r.summary && <p className="mt-1 text-xs">{r.summary}</p>}
              {r.status === "skipped" && (
                <form action={retryAnywayAction} className="mt-2">
                  <input type="hidden" name="id" value={r.id} />
                  <button className="btn btn-sm">Write it anyway</button>
                </form>
              )}
            </li>
          ))}
          {!reqs.length && <li className="text-muted">Nothing yet.</li>}
        </ul>
      </section>
    </div>
  );
}
