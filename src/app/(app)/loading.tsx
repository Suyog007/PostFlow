import { PlaneLoader } from "@/components/plane-loader";

/** Shown while an app page loads: the plane in flight, centred. */
export default function Loading() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-[16px] text-[var(--muted)]">
      <PlaneLoader size="lg" label="Loading" />
      <span>Loading…</span>
    </div>
  );
}
