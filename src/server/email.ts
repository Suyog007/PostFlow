import nodemailer from "nodemailer";
import { env } from "./env";
import { log } from "./log";

export interface Email {
  to: string;
  subject: string;
  /** Plain-text version; also used to build the HTML body. */
  text: string;
  /** Optional call-to-action button. */
  action?: { label: string; url: string };
}

/** Emails "sent" while no email service is set up (development and tests). */
export const outbox: Email[] = [];

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function html(e: Email) {
  const paras = e.text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const button = e.action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(e.action.url)}" style="background:#12151b;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(e.action.label)}</a></p>
       <p style="margin:0 0 16px;color:#5b6573;font-size:13px">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(e.action.url)}</span></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#12151b">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <p style="font-weight:700;font-size:16px;margin:0 0 24px">${escapeHtml(env().COMPANY_NAME)}</p>
    <div style="background:#ffffff;border:1px solid #e1e4ea;border-radius:12px;padding:24px;font-size:15px;line-height:1.55">${paras}${button}</div>
    <p style="color:#8a93a2;font-size:12px;margin:16px 0 0">You received this because of an action on your ${escapeHtml(env().COMPANY_NAME)} account.</p>
  </div></body></html>`;
}

let gmail: nodemailer.Transporter | null = null;
function gmailTransport() {
  if (!gmail) {
    gmail = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      // Google shows app passwords in groups of four; the spaces are not part of it.
      auth: { user: env().GMAIL_USER!, pass: env().GMAIL_APP_PASSWORD!.replace(/\s+/g, "") },
    });
  }
  return gmail;
}

/** Test hook: replace the Gmail transport. */
export function setGmailTransportForTests(t: nodemailer.Transporter | null) {
  gmail = t;
}

/** Which service sends email: Gmail when an app password is set, else Resend, else none (logged only). */
export function emailProvider(): "gmail" | "resend" | null {
  const e = env();
  if (e.GMAIL_USER && e.GMAIL_APP_PASSWORD) return "gmail";
  if (e.RESEND_API_KEY) return "resend";
  return null;
}

/** Sends through Gmail or Resend. With neither set up the email is logged instead (and kept in `outbox`). */
export async function sendEmail(e: Email): Promise<void> {
  const provider = emailProvider();
  if (!provider) {
    outbox.push(e);
    log.info("email_not_sent_no_api_key", { to: e.to, subject: e.subject, link: e.action?.url });
    return;
  }
  const text = e.action ? `${e.text}\n\n${e.action.label}: ${e.action.url}` : e.text;
  const replyTo = env().CONTACT_EMAIL || undefined;
  if (provider === "gmail") {
    try {
      await gmailTransport().sendMail({
        from: { name: env().GMAIL_FROM_NAME || env().COMPANY_NAME, address: env().GMAIL_USER! },
        to: e.to,
        subject: e.subject,
        text,
        html: html(e),
        replyTo,
      });
    } catch (err) {
      log.error("email_send_failed", { provider, error: String(err).slice(0, 300) });
      throw new Error("We could not send the email. Please try again in a minute.");
    }
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env().RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env().EMAIL_FROM,
      to: [e.to],
      subject: e.subject,
      text,
      html: html(e),
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    log.error("email_send_failed", { provider, status: res.status, body: body.slice(0, 300) });
    throw new Error("We could not send the email. Please try again in a minute.");
  }
}
