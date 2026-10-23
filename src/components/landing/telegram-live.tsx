"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui";
import { useInView, usePrefersReducedMotion } from "./motion";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const TOTAL = 6;

/**
 * The Telegram bot as it really talks: a heads-up before a post, one tap to approve, a note sent from the
 * phone, and a confirmation once it is live. Messages arrive one by one when the chat scrolls into view.
 */
export function TelegramLive() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { margin: "0px 0px -15% 0px" });
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(TOTAL);
  const [tapped, setTapped] = useState(true);

  useEffect(() => {
    if (reduced || !seen) return;
    let dead = false;
    (async () => {
      setShown(0);
      setTapped(false);
      for (let i = 1; i <= TOTAL && !dead; i++) {
        await sleep(i === 1 ? 300 : 1100);
        setShown(i);
        if (i === 2) {
          await sleep(900);
          setTapped(true);
        }
      }
    })();
    return () => {
      dead = true;
    };
  }, [seen, reduced]);

  const msg = (n: number, className: string, children: React.ReactNode) =>
    shown >= n ? <div className={`pop-in ${className}`}>{children}</div> : null;

  return (
    // fixmyslop-ignore[ui/neon-glow] neutral grey drop shadow under the chat window, not a coloured glow
    <div ref={ref} className="mx-auto w-full max-w-[400px] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_24px_48px_-24px_rgba(16,24,40,.25)]">
      <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)]"><Icon name="send" size={16} /></span>
        <div>
          <p className="text-[14px] font-semibold leading-tight">PostFlow bot</p>
          <p className="text-[12px] text-[var(--subtle)]">bot</p>
        </div>
      </div>
      <div className="min-h-[430px] space-y-2.5 bg-[var(--raised)] p-4 text-[13px] leading-relaxed" aria-label="Example Telegram conversation">
        {msg(1, "max-w-[88%] rounded-2xl rounded-tl-md bg-[var(--surface)] p-3 shadow-[0_1px_0_var(--line)]", (
          <>
            <p className="font-medium">Going out in about 8 minutes</p>
            <p className="text-[var(--muted)]">LinkedIn · Fri 23 Oct, 09:15</p>
            <p className="mt-2">CI went from 14 minutes to 4. Caching dependencies did most of the work, so look at the cache before you blame the runners.</p>
            <p className="mt-2 text-[var(--muted)]">Not approved yet. If you do nothing it is skipped.</p>
          </>
        ))}
        {shown >= 1 && !tapped && (
          <div className="grid max-w-[88%] grid-cols-2 gap-1.5 text-center text-[12px] font-medium">
            {["Approve", "Remove", "Reject, find another", "Post now"].map((b) => (
              <span key={b} className="rounded-lg bg-[var(--surface)] px-2 py-2 shadow-[0_1px_0_var(--line)]">{b}</span>
            ))}
          </div>
        )}
        {msg(2, "ml-auto max-w-[60%] rounded-2xl rounded-tr-md bg-[var(--accent)] px-3 py-2 text-center font-medium text-[var(--accent-ink)]", "Approve")}
        {tapped && msg(3, "max-w-[88%] rounded-2xl rounded-tl-md bg-[var(--surface)] p-3 shadow-[0_1px_0_var(--line)]", "Approved. It goes out on time unless you remove it.")}
        {msg(4, "ml-auto max-w-[80%] rounded-2xl rounded-tr-md bg-[var(--accent)] p-3 text-[var(--accent-ink)]", "Shipped invoice exports today. The CSV was easy, the timezone handling took all afternoon.")}
        {msg(5, "max-w-[88%] rounded-2xl rounded-tl-md bg-[var(--surface)] p-3 shadow-[0_1px_0_var(--line)]", "Saved as a note. I will turn it into a post for an upcoming slot.")}
        {msg(6, "max-w-[88%] rounded-2xl rounded-tl-md bg-[var(--surface)] p-3 shadow-[0_1px_0_var(--line)]", (
          <>
            <p className="font-medium text-[var(--good)]">Posted on LinkedIn</p>
            <p className="mt-1 text-[var(--muted)]">&quot;CI went from 14 minutes to 4. Caching dependencies did most of…&quot;</p>
          </>
        ))}
      </div>
    </div>
  );
}
