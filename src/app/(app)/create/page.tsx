import { DateTime } from "luxon";
import Link from "next/link";
import { getSettings } from "@/server/settings";
import { requireActiveUser } from "@/server/auth";
import { entitlementOf } from "@/server/billing/plans";
import { recentRequests } from "@/server/requests";
import { createPostAction, addTipAction } from "@/app/actions";
import { Flash } from "../flash";

export const dynamic = "force-dynamic";

export default async function CreatePage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await requireActiveUser();
  const links = entitlementOf(user).features.links;
  const s = await getSettings();
  const reqs = await recentRequests(8);
  return (
    <div className="max-w-3xl space-y-8">
      <Flash ok={sp.ok} error={sp.error} />
      <section>
        <h1 className="mb-1 text-lg font-semibold">Create a post</h1>
        <p className="mb-4 text-sm text-muted">Give me an idea, a link, or a link with your angle. I write it for each platform, the reviewer checks it, and it goes on the calendar unless you ask for a draft.</p>
        <form action={createPostAction} className="card space-y-3 p-4 text-sm">
          <textarea name="text" rows={5} required placeholder={"An idea: Most teams add caching before they measure. Here is what I check first.\nA link: https://example.com/article\nA link with your angle: https://example.com/article  the pricing change matters more than the model"} className="textarea" />
          {links ? (
            <label className="flex items-center gap-2"><input type="checkbox" name="own" /> The link is my own article. Write it as me and include the link in the post.</label>
          ) : (
            <p className="text-[12px] text-[var(--muted)]">On Starter, describe the idea in your own words. Writing from a link or your own articles is part of <Link href="/billing" className="underline">Pro</Link>.</p>
          )}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-2"><input type="checkbox" name="p_linkedin" defaultChecked /> LinkedIn</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="p_x" defaultChecked /> X</label>
            <select name="mode" className="input w-auto" defaultValue="schedule">
              <option value="schedule">Put on the calendar (next free slot)</option>
              <option value="soon">Post in about 20 minutes</option>
              <option value="draft">Draft only, I will decide</option>
            </select>
            <button className="btn-primary">Create</button>
          </div>
          {s.ownDomains.length > 0 && <p className="text-xs text-muted">Links to {s.ownDomains.join(", ")} are treated as your own articles automatically.</p>}
        </form>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Tip a story</h2>
        <p className="mb-3 text-sm text-muted">Saw something worth sharing? Paste the link. It joins the news pipeline and is posted only if other publishers confirm it. Use "Create a post" above to skip that check and write about it yourself.</p>
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
              <p className="mt-1 text-xs text-muted">{DateTime.fromJSDate(r.createdAt, { zone: s.timezone }).toFormat("d LLL HH:mm")} · {r.status}{r.error ? `: ${r.error}` : ""}</p>
            </li>
          ))}
          {!reqs.length && <li className="text-muted">Nothing yet.</li>}
        </ul>
      </section>
    </div>
  );
}
