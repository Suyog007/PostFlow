"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, getSessionUser, rateLimited, startSession } from "@/server/auth";
import { visitSource } from "@/server/attribution";
import { AuthError, checkPassword, consumeToken, createUser, emailSchema, issueResetToken, markVerified, passwordSchema, peekTokenUser, sendPasswordReset, sendVerificationEmail, setPassword } from "@/server/users";
import { safeNext } from "@/server/google";
import { log } from "@/server/log";
import { clear, hit, over } from "@/server/rate-limit";

export type FormState = { error?: string; ok?: string } | null;

function message(err: unknown): string {
  if (err instanceof AuthError) return err.message;
  if (err instanceof z.ZodError) return err.issues[0]?.message ?? "Check the form and try again.";
  log.error("auth_action_failed", { error: (err as Error).message });
  return (err as Error).message?.startsWith("We could not send") ? (err as Error).message : "Something went wrong. Please try again.";
}

const LOGIN_WINDOW = 15 * 60_000;
const TOO_MANY = "Too many attempts. Wait 15 minutes and try again.";

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  // Per address: every attempt counts. Per account: only failures count, so a stuffing run spread
  // over many addresses still stops, and the right password works again after a success.
  const accountKey = `login:email:${email}`;
  if ((await rateLimited("login", 30, LOGIN_WINDOW)) || (await over(accountKey, 10))) return { error: TOO_MANY };
  let user;
  try {
    user = await checkPassword(email, String(form.get("password") ?? ""));
  } catch (err) {
    if (err instanceof AuthError) await hit(accountKey, 10, LOGIN_WINDOW);
    return { error: message(err) };
  }
  await clear(accountKey);
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
  if (await rateLimited("resend", 10, 60 * 60_000)) return { error: "Too many requests. Try again later." };
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
  if (await rateLimited("reset", 20, 60 * 60_000)) return { error: "Too many requests. Try again later." };
  const password = passwordSchema.safeParse(String(form.get("password") ?? ""));
  if (!password.success) return { error: password.error.issues[0].message };
  const user = await consumeToken(String(form.get("token") ?? ""), "reset");
  if (!user) return { error: "That reset link has expired or was already used. Request a new one." };
  const updated = await setPassword(user.id, password.data);
  await startSession(updated);
  redirect("/calendar");
}

const EXPIRED_LINK = "That link has expired or was already used. Sign in and send a new one.";

/**
 * Confirms the email from the link. Signs in only someone who already holds the sign-up session or who
 * types the sign-up password: owning the inbox alone does not prove they chose that password, and
 * whoever did could otherwise sign in later and post as the inbox owner.
 */
export async function confirmEmailAction(_: FormState, form: FormData): Promise<FormState> {
  if (await rateLimited("login", 30, LOGIN_WINDOW)) return { error: TOO_MANY };
  const token = String(form.get("token") ?? "");
  const owner = await peekTokenUser(token, "verify");
  if (!owner) return { error: EXPIRED_LINK };
  const current = await getSessionUser();
  if (current?.id !== owner.id) {
    const accountKey = `login:email:${owner.email}`;
    if (await over(accountKey, 10)) return { error: TOO_MANY };
    try {
      await checkPassword(owner.email, String(form.get("password") ?? ""));
    } catch (err) {
      if (err instanceof AuthError) await hit(accountKey, 10, LOGIN_WINDOW);
      return { error: message(err) };
    }
  }
  const used = await consumeToken(token, "verify");
  if (used?.id !== owner.id) return { error: EXPIRED_LINK };
  await startSession(await markVerified(owner.id));
  redirect("/calendar?welcome=1");
}

/** "I did not sign up, or I forgot the password": confirm the inbox, drop the sign-up password, choose a new one. */
export async function confirmEmailNewPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const used = await consumeToken(String(form.get("token") ?? ""), "verify");
  if (!used) return { error: EXPIRED_LINK };
  await markVerified(used.id, { clearPassword: true });
  let reset: string;
  try {
    reset = await issueResetToken(used.id);
  } catch (err) {
    return { error: message(err) };
  }
  redirect(`/reset?token=${reset}&confirmed=1`);
}
