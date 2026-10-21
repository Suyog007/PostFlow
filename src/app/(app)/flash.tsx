import { Icon } from "@/components/ui";

export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return (
    <div role="status" className={`mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] ${error ? "border-[var(--bad)]/30 bg-[var(--bad-soft)] text-[var(--bad)]" : "border-[var(--good)]/30 bg-[var(--good-soft)] text-[var(--good)]"}`}>
      <Icon name={error ? "alert" : "check"} size={16} className="mt-0.5 flex-none" />
      <span>{error ?? ok}</span>
    </div>
  );
}
