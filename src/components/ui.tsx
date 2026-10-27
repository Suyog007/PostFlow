import type { ReactNode } from "react";

type IconName =
  | "calendar" | "create" | "notes" | "settings" | "bolt" | "check" | "clock" | "link" | "trash" | "pencil"
  | "pause" | "play" | "send" | "x" | "left" | "right" | "alert" | "shield" | "draft" | "external" | "like" | "comment" | "repost" | "share" | "bookmark" | "chart";

const PATHS: Record<IconName, ReactNode> = {
  calendar: <><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9.5h18M8 3v3M16 3v3" /></>,
  create: <><path d="M12 5v14M5 12h14" /></>,
  notes: <><path d="M6 3.5h9l4 4V20a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 20z" /><path d="M14.5 3.5V8H19M9 12.5h6M9 16h6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.2M12 18.8V21M4.6 7.5l1.9 1.1M17.5 15.4l1.9 1.1M4.6 16.5l1.9-1.1M17.5 8.6l1.9-1.1" /></>,
  bolt: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  trash: <><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5" /></>,
  pencil: <path d="m4 20 1-4L16.5 4.5a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8 19zM14.5 6.5l3 3" />,
  pause: <><path d="M8 5v14M16 5v14" /></>,
  play: <path d="M7 4.5v15l12-7.5z" />,
  send: <path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4z" />,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  left: <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />,
  right: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  alert: <><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4.5M12 17.2v.1" /></>,
  shield: <><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6z" /><path d="m9 12 2.3 2.3L15.5 10" /></>,
  draft: <><path d="M5 20h14M6.5 16.5 7.5 13 16 4.5a2 2 0 0 1 2.8 2.8L10.3 15.8z" /></>,
  external: <path d="M14 4h6v6M20 4 11 13M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  like: <path d="M7 11v9H4.5V11zM7 11l3.5-7c1.5 0 2.5 1 2.5 2.5V9h5.2a2 2 0 0 1 2 2.4l-1.2 6.5a2 2 0 0 1-2 1.6H7" />,
  comment: <path d="M4 5.5h16v10H12l-4.5 3.5v-3.5H4z" />,
  repost: <><path d="M4 11V9a2 2 0 0 1 2-2h12l-2.5-2.5M20 13v2a2 2 0 0 1-2 2H6l2.5 2.5" /></>,
  share: <path d="M12 15V3.5M7.5 8 12 3.5 16.5 8M5 13v6.5h14V13" />,
  bookmark: <path d="M6.5 4h11v16.5L12 16.5 6.5 20.5z" />,
  chart: <path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6" />,
};

export function Icon({ name, size = 16, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="var(--ink)" />
      <path d="M6 15.5v2M10 12v5.5M14 8.5v9M18 6v11.5" stroke="var(--bg)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Platform mark: LinkedIn "in" tile, X glyph. */
export function PlatformGlyph({ platform, size = 16 }: { platform: string; size?: number }) {
  if (platform === "x") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-label="X" role="img">
        <path fill="var(--x)" d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.3L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.4 4.7H5.6z" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="LinkedIn" role="img">
      <rect width="24" height="24" rx="4" fill="var(--li)" />
      <path fill="#fff" d="M6.3 9.6h2.6V18H6.3zM7.6 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM10.6 9.6h2.5v1.2c.4-.7 1.3-1.4 2.6-1.4 2.7 0 3.2 1.8 3.2 4V18h-2.6v-4c0-1 0-2.2-1.4-2.2s-1.6 1-1.6 2.1V18h-2.6z" />
    </svg>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = (name || "You").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="inline-flex flex-none items-center justify-center rounded-full font-semibold" style={{ width: size, height: size, fontSize: size * 0.38, background: "var(--accent-soft)", color: "var(--accent)" }}>
      {initials}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="display text-[30px] sm:text-[36px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[14px] text-[var(--muted)]">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    // The label wraps its field, so screen readers and clicks on the label reach the input.
    <div>
      <label className="block">
        <span className="label">{label}</span>
        {children}
      </label>
      {hint && <p className="hint mt-1">{hint}</p>}
    </div>
  );
}

export function Switch({ name, label, hint, defaultChecked }: { name: string; label: ReactNode; hint?: ReactNode; defaultChecked?: boolean }) {
  return (
    <label className="switch items-start">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      <span className="track mt-0.5" />
      <span className="text-[13px]">
        {label}
        {hint && <span className="hint block">{hint}</span>}
      </span>
    </label>
  );
}

export function StatusBadge({ status, needsApproval }: { status: string; needsApproval?: boolean }) {
  if (needsApproval) return <span className="badge badge-warn">Needs your OK</span>;
  const map: Record<string, [string, string]> = {
    scheduled: ["badge-info", "Scheduled"],
    publishing: ["badge-info", "Publishing"],
    published: ["badge-good", "Posted"],
    draft: ["", "Draft"],
    cancelled: ["", "Removed"],
    declined: ["", "Rejected by you"],
    failed: ["badge-bad", "Failed"],
    unconfirmed: ["badge-warn", "Needs check"],
    expired: ["", "Expired"],
    rejected: ["badge-bad", "Held back"],
  };
  const [cls, text] = map[status] ?? ["", status];
  return <span className={`badge ${cls}`}>{text}</span>;
}
