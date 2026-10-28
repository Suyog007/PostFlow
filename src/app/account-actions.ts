"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { endSession, requireUser, startSession } from "@/server/auth";
import { verifyPassword } from "@/server/crypto";
import { passwordSchema, sendPasswordReset, setPassword } from "@/server/users";
import { cancelSubscriptionNow } from "@/server/billing/stripe";
import { log } from "@/server/log";
import { revokeAllAccounts } from "@/server/platforms/accounts";

const back = (kind: "ok" | "error", msg: string): never => redirect(`/account?${kind}=${encodeURIComponent(msg)}`);

export async function changePasswordAction(form: FormData) {
  const user = await requireUser();
  if (user.passwordHash && !verifyPassword(String(form.get("current") ?? ""), user.passwordHash)) back("error", "Your current password is not right.");
  const next = passwordSchema.safeParse(String(form.get("password") ?? ""));
  if (!next.success) back("error", next.error!.issues[0].message);
  const updated = await setPassword(user.id, next.data!);
  await startSession(updated); // keep this device signed in; others are signed out
  back("ok", "Password changed. Other devices were signed out.");
}

/** For Google-only accounts: email a link to set a password. */
export async function sendSetPasswordLinkAction() {
  const user = await requireUser();
  try {
    await sendPasswordReset(user.email);
  } catch (err) {
    back("error", (err as Error).message);
  }
  back("ok", `We emailed a link to ${user.email} to set a password.`);
}

export async function signOutEverywhereAction() {
  const user = await requireUser();
  await db().update(schema.users).set({ sessionVersion: user.sessionVersion + 1, updatedAt: new Date() }).where(eq(schema.users.id, user.id));
  await endSession();
  redirect("/login");
}

/** Cancels billing and deletes the account and everything in it. */
export async function deleteAccountAction(form: FormData) {
  const user = await requireUser();
  if (String(form.get("confirm") ?? "").trim().toLowerCase() !== user.email) back("error", "Type your email address exactly to confirm.");
  if (user.isOwner) back("error", "Owner accounts cannot be deleted here. Remove the email from OWNER_EMAILS first.");
  try {
    await cancelSubscriptionNow(user);
  } catch (err) {
    log.error("delete_account_cancel_failed", { userId: user.id, error: (err as Error).message });
    back("error", "We could not cancel your subscription, so nothing was deleted. Please try again or contact support.");
  }
  await revokeAllAccounts(); // cancel LinkedIn and X access before the stored tokens are deleted
  await db().delete(schema.settings).where(eq(schema.settings.id, user.id));
  await db().delete(schema.users).where(eq(schema.users.id, user.id)); // everything else is removed by ON DELETE CASCADE
  await endSession();
  redirect("/?deleted=1");
}
