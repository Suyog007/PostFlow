import { afterEach, describe, expect, it, vi } from "vitest";
import type { Transporter } from "nodemailer";
import { resetEnvCache } from "../src/server/env";
import { emailProvider, outbox, sendEmail, setGmailTransportForTests } from "../src/server/email";

const KEYS = ["GMAIL_USER", "GMAIL_APP_PASSWORD", "GMAIL_FROM_NAME", "RESEND_API_KEY"];

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}

describe("sending email", () => {
  afterEach(() => {
    setEnv(Object.fromEntries(KEYS.map((k) => [k, undefined])));
    setGmailTransportForTests(null);
    vi.unstubAllGlobals();
    outbox.length = 0;
  });

  it("keeps the email in the outbox when nothing is set up", async () => {
    setEnv({ GMAIL_USER: undefined, GMAIL_APP_PASSWORD: undefined, RESEND_API_KEY: undefined });
    expect(emailProvider()).toBeNull();
    await sendEmail({ to: "a@example.com", subject: "Hi", text: "Hello" });
    expect(outbox).toHaveLength(1);
  });

  it("sends through Gmail when an app password is set, even if Resend is set too", async () => {
    setEnv({ GMAIL_USER: "me@gmail.com", GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop", GMAIL_FROM_NAME: "PostFlow", RESEND_API_KEY: "re_x" });
    const sendMail = vi.fn().mockResolvedValue({ messageId: "1" });
    setGmailTransportForTests({ sendMail } as unknown as Transporter);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(emailProvider()).toBe("gmail");
    await sendEmail({ to: "guest@example.com", subject: "Verify", text: "Click it", action: { label: "Verify", url: "https://x.test/v?t=1" } });

    expect(fetchSpy).not.toHaveBeenCalled();
    const mail = sendMail.mock.calls[0][0];
    expect(mail.from).toEqual({ name: "PostFlow", address: "me@gmail.com" });
    expect(mail.to).toBe("guest@example.com");
    expect(mail.text).toContain("https://x.test/v?t=1");
    expect(mail.html).toContain("https://x.test/v?t=1");
    expect(outbox).toHaveLength(0);
  });

  it("shows a friendly error when Gmail refuses", async () => {
    setEnv({ GMAIL_USER: "me@gmail.com", GMAIL_APP_PASSWORD: "wrong" });
    setGmailTransportForTests({ sendMail: vi.fn().mockRejectedValue(new Error("535 bad credentials")) } as unknown as Transporter);
    await expect(sendEmail({ to: "a@example.com", subject: "Hi", text: "Hello" })).rejects.toThrow(/could not send/);
  });

  it("falls back to Resend without Gmail", async () => {
    setEnv({ RESEND_API_KEY: "re_x" });
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(emailProvider()).toBe("resend");
    await sendEmail({ to: "a@example.com", subject: "Hi", text: "Hello" });
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.resend.com/emails");
  });
});
