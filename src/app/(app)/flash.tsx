export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return (
    <div className={`mb-4 rounded-lg border px-4 py-2 text-sm ${error ? "border-bad text-bad" : "border-line text-good"}`}>{error ?? ok}</div>
  );
}
