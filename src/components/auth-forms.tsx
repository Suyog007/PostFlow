"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { forgotPasswordAction, loginAction, resendVerificationAction, resetPasswordAction, signupAction, type FormState } from "@/app/auth-actions";

function Status({ state }: { state: FormState }) {
  if (state?.error) return <p role="alert" className="text-[13px] text-[var(--bad)]">{state.error}</p>;
  if (state?.ok) return <p role="status" className="rounded-md bg-[var(--good-soft)] px-3 py-2 text-[13px] text-[var(--good)]">{state.ok}</p>;
  return null;
}

function useTimezone() {
  const [tz, setTz] = useState("");
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""), []);
  return tz;
}

export function GoogleButton({ next = "/calendar", label = "Continue with Google" }: { next?: string; label?: string }) {
  const tz = useTimezone();
  const href = `/api/auth/google?next=${encodeURIComponent(next)}${tz ? `&tz=${encodeURIComponent(tz)}` : ""}`;
  return (
    <a href={href} className="btn h-10 w-full text-[14px]">
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      {label}
    </a>
  );
}

export function Divider() {
  return (
    <div className="my-4 flex items-center gap-3 text-[12px] text-[var(--subtle)]">
      <span className="h-px flex-1 bg-[var(--line)]" />
      or
      <span className="h-px flex-1 bg-[var(--line)]" />
    </div>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next ?? "/calendar"} />
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="input h-10" />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor="password" className="label">Password</label>
          <Link href="/forgot" className="text-[12px] text-[var(--muted)] hover:text-[var(--ink)]">Forgot password?</Link>
        </div>
        <input id="password" name="password" type="password" required autoComplete="current-password" className="input h-10" />
      </div>
      <Status state={state} />
      <button className="btn btn-primary h-10 w-full text-[14px]" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState(signupAction, null);
  const tz = useTimezone();
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="tz" value={tz} />
      <div>
        <label htmlFor="name" className="label">Your name</label>
        <input id="name" name="name" required maxLength={80} autoComplete="name" className="input h-10" />
      </div>
      <div>
        <label htmlFor="email" className="label">Work email</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="input h-10" />
      </div>
      <div>
        <label htmlFor="password" className="label">Password</label>
        <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input h-10" />
        <p className="hint mt-1">At least 10 characters.</p>
      </div>
      <label className="flex items-start gap-2 text-[13px] text-[var(--muted)]">
        <input type="checkbox" name="terms" required className="mt-0.5" />
        <span>
          I agree to the <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </span>
      </label>
      <Status state={state} />
      <button className="btn btn-primary h-10 w-full text-[14px]" disabled={pending}>{pending ? "Creating account…" : "Create account"}</button>
    </form>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, null);
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="input h-10" />
      </div>
      <Status state={state} />
      <button className="btn btn-primary h-10 w-full text-[14px]" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</button>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <div>
        <label htmlFor="password" className="label">New password</label>
        <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input h-10" />
        <p className="hint mt-1">At least 10 characters. You will be signed out on other devices.</p>
      </div>
      <Status state={state} />
      <button className="btn btn-primary h-10 w-full text-[14px]" disabled={pending}>{pending ? "Saving…" : "Save password"}</button>
    </form>
  );
}

export function ResendForm() {
  const [state, action, pending] = useActionState(resendVerificationAction, null);
  return (
    <form action={action} className="space-y-3">
      <Status state={state} />
      <button className="btn h-10 w-full text-[14px]" disabled={pending}>{pending ? "Sending…" : "Send the link again"}</button>
    </form>
  );
}
