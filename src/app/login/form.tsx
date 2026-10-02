"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/actions";
import { ResultMessage } from "@/components/client";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" autoFocus />
      </div>
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <ResultMessage result={state} />
    </form>
  );
}
