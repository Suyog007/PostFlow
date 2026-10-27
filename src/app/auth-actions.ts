"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, getSessionUser, rateLimited, startSession } from "@/server/auth";
import { visitSource } from "@/server/attribution";
import { AuthError, checkPassword, consumeToken, createUser, emailSchema, passwordSchema, sendPasswordReset, sendVerificationEmail, setPassword } from "@/server/users";
import { safeNext } from "@/server/google";
import { log } from "@/server/log";

export type FormState = { error?: string; ok?: string } | null;

function message(err: unknown): string {
  if (err instanceof AuthError) return err.message;
  if (err instanceof z.ZodError) return err.issues[0]?.message ?? "Check the form and try again.";
  log.error("auth_action_failed", { error: (err as Error).message });
  return (err as Error).message?.startsWith("We could not send") ? (err as Error).message : "Something went wrong. Please try again.";
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  if (await rateLimited("login")) return { error: "Too many attempts. Wait 15 minutes and try again." };
  let user;
  try {
    user = await checkPassword(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
  } catch (err) {
    return { error: message(err) };
  }
  await startSession(user);
  redirect(safeNext(String(form.get("next") ?? "")));
}

export async function signupAction(_: FormState, form: FormData): Promise<FormState> {
  if (await rateLimited("signup", 5, 60 * 60_000)) return { error: "Too many sign-ups from this network. Try again later." };
  let user;
  try {
    const email = emailSchema.parse(form.get("email"));
    const password = passwordSchema.parse(String(form.get("password") ?? ""));
    if (!form.get("terms")) return { error: "Please accept the terms to continue." };
    user = await createUser({ email, password, name: String(form.get("name") ?? ""), verified: false, timezone: String(form.get("tz") ?? "") || undefined, source: await visitSource() });
    await startSession(user);
    await sendVerificationEmail(user);
  } catch (err) {
    return { error: message(err) };
  }
  redirect("/verify-email");
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

export async function resendVerificationAction(): Promise<FormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.emailVerifiedAt) redirect("/calendar");
  try {
    await sendVerificationEmail(user);
  } catch (err) {
    return { error: message(err) };
  }
  return { ok: `Sent. Check ${user.email} (and the spam folder).` };
}

export async function forgotPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  if (await rateLimited("forgot", 5, 60 * 60_000)) return { error: "Too many requests. Try again later." };
  const email = emailSchema.safeParse(form.get("email"));
  if (!email.success) return { error: "Enter a valid email address." };
  try {
    await sendPasswordReset(email.data);
  } catch (err) {
    // Rate limits on a real account must not reveal that the account exists.
    if (!(err instanceof AuthError)) return { error: message(err) };
  }
  return { ok: "If there is an account for that email, a reset link is on its way. It works for one hour." };
}

export async function resetPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const password = passwordSchema.safeParse(String(form.get("password") ?? ""));
  if (!password.success) return { error: password.error.issues[0].message };
  const user = await consumeToken(String(form.get("token") ?? ""), "reset");
  if (!user) return { error: "That reset link has expired or was already used. Request a new one." };
  const updated = await setPassword(user.id, password.data);
  await startSession(updated);
  redirect("/calendar");
}
