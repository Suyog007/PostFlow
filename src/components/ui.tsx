import Link from "next/link";
import { clsx } from "clsx";
import { platformName } from "@/lib/format";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx("mb-8", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "accent" | "good" | "warn" | "bad"; className?: string }) {
  const tones = {
    neutral: "bg-paper text-muted border-line",
    accent: "bg-accent-soft text-accent border-transparent",
    good: "bg-green-50 text-good border-green-200 dark:bg-green-950/40 dark:border-green-900",
    warn: "bg-amber-50 text-warn border-amber-200 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-400",
    bad: "bg-red-50 text-bad border-red-200 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400",
  };
  return <span className={clsx("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

export function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold text-white",
        platform === "x" ? "bg-x dark:text-black" : "bg-li",
      )}
    >
      {platformName(platform)}
    </span>
  );
}

const STATUS_TONE: Record<string, "neutral" | "accent" | "good" | "warn" | "bad"> = {
  draft: "neutral",
  awaiting_approval: "warn",
  approved: "accent",
  scheduled: "accent",
  publishing: "accent",
  published: "good",
  failed: "bad",
  rejected: "neutral",
  cancelled: "neutral",
  needs_review: "warn",
  unknown: "warn",
};
const STATUS_LABEL: Record<string, string> = {
  awaiting_approval: "Needs approval",
  needs_review: "Needs review",
  unknown: "Unconfirmed",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}</Badge>;
}

export function TimelinessBadge({ t }: { t: string | null }) {
  if (!t) return null;
  const map: Record<string, ["warn" | "accent" | "neutral", string]> = {
    breaking: ["warn", "Time-sensitive"],
    timely: ["accent", "Timely"],
    evergreen: ["neutral", "Evergreen"],
  };
  const [tone, label] = map[t] ?? ["neutral", t];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-start gap-3 p-6 text-sm text-muted">
      <div>{children}</div>
      {action}
    </div>
  );
}

export function Notice({ tone = "accent", children }: { tone?: "accent" | "warn" | "bad" | "good"; children: React.ReactNode }) {
  const tones = {
    accent: "border-accent/30 bg-accent-soft",
    warn: "border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900",
    bad: "border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900",
    good: "border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-900",
  };
  return <div className={clsx("mb-4 rounded-lg border px-4 py-3 text-sm", tones[tone])}>{children}</div>;
}

export function ScoreMeter({ score }: { score: number | null }) {
  if (score == null) return null;
  const tone = score >= 70 ? "bg-good" : score >= 50 ? "bg-accent" : "bg-muted";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title="Recommendation score out of 100 (not a prediction of performance)">
      <span className="relative h-1.5 w-12 overflow-hidden rounded-full bg-line">
        <span className={clsx("absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${Math.min(100, score)}%` }} />
      </span>
      {Math.round(score)}
    </span>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-accent hover:underline">
      {children}
    </Link>
  );
}

export function PlatformChecks({ suggested }: { suggested?: string[] }) {
  const on = (p: string) => (suggested?.length ? suggested.includes(p) : true);
  return (
    <div className="flex gap-4 text-sm">
      <label className="flex items-center gap-1.5">
        <input type="checkbox" name="platform_linkedin" defaultChecked={on("linkedin")} /> LinkedIn
      </label>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" name="platform_x" defaultChecked={on("x")} /> X
      </label>
    </div>
  );
}
