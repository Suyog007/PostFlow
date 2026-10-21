"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null as { error: string } | null);
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="pw" className="label">Password</label>
        <input id="pw" name="password" type="password" autoFocus required autoComplete="current-password" className="input" />
      </div>
      {state?.error && <p role="alert" className="text-[13px] text-[var(--bad)]">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Signing in…" : "Continue"}</button>
    </form>
  );
}
