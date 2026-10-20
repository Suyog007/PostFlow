import { Avatar, Icon } from "./ui";

function Linkified({ text, color }: { text: string; color: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+|#[\p{L}\p{N}_]+)/gu);
  return (
    <>
      {parts.map((p, i) => (/^(https?:\/\/|#)/.test(p) ? <span key={i} style={{ color }}>{p}</span> : <span key={i}>{p}</span>))}
    </>
  );
}

/** What the post will look like where it lands. */
export function PostPreview({ platform, name, role, handle, text }: { platform: string; name: string; role: string; handle: string; text: string }) {
  if (platform === "x") {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3.5">
        <div className="flex gap-2.5">
          <Avatar name={name} size={38} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5 text-[14px]">
              <span className="truncate font-bold">{name}</span>
              <span className="truncate text-[var(--subtle)]">@{handle} · now</span>
            </div>
            <p className="post-text mt-0.5 text-[15px] leading-[1.4]"><Linkified text={text || " "} color="#1d9bf0" /></p>
            <div className="mt-3 flex max-w-[300px] justify-between text-[var(--subtle)]">
              <Icon name="comment" size={16} /><Icon name="repost" size={16} /><Icon name="like" size={16} /><Icon name="chart" size={16} /><Icon name="share" size={16} />
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <div className="flex gap-2.5 p-3.5 pb-2">
        <Avatar name={name} size={44} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[14px] font-semibold">{name}</div>
          <div className="truncate text-[12px] text-[var(--muted)]">{role}</div>
          <div className="text-[12px] text-[var(--subtle)]">Now</div>
        </div>
      </div>
      <p className="post-text px-3.5 pb-3 text-[14px] leading-[1.45]"><Linkified text={text || " "} color="var(--li)" /></p>
      <div className="flex justify-around border-t border-[var(--line)] px-2 py-1.5 text-[12px] font-medium text-[var(--muted)]">
        {([["like", "Like"], ["comment", "Comment"], ["repost", "Repost"], ["send", "Send"]] as const).map(([i, l]) => (
          <span key={l} className="flex items-center gap-1.5 px-2 py-1"><Icon name={i} size={16} />{l}</span>
        ))}
      </div>
    </div>
  );
}
