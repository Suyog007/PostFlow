"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** A submit button that shows what is happening while a slow server action (a model call) runs. */
export function SubmitButton({ children, pending, className = "btn" }: { children: ReactNode; pending: string; className?: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <button className={className} disabled={busy} aria-busy={busy}>
      {busy ? pending : children}
    </button>
  );
}
