"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null as { error: string } | null);
  return (
    <form action={action} className="space-y-3">
      <input name="password" type="password" autoFocus required placeholder="Password" className="input" />
      {state?.error && <p className="text-sm text-bad">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
