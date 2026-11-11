"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { PlaneLoader } from "./plane-loader";

/** A submit button that shows what is happening while a slow server action (a model call) runs. */
export function SubmitButton({ children, pending, className = "btn" }: { children: ReactNode; pending: string; className?: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <button className={className} disabled={busy} aria-busy={busy}>
      {busy ? <><PlaneLoader size="sm" label={pending} /><span>{pending}</span></> : children}
    </button>
  );
}
