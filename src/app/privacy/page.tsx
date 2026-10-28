import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-shell";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "Privacy Policy · PostFlow", robots: { index: true, follow: true } };
// Reads settings that can change without a rebuild.
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  const { COMPANY_NAME, LEGAL_ENTITY, CONTACT_EMAIL: contact } = env();
  const company = LEGAL_ENTITY ?? COMPANY_NAME;
  return (
    <LegalShell title="Privacy Policy" updated="27 October 2026">
      <p>This policy explains what {company} collects when you use PostFlow, why, and the choices you have.</p>
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account details:</strong> your name, email address and either a password (stored only as a salted hash) or your Google account identifier.</li>
        <li><strong>Connected accounts:</strong> access tokens for LinkedIn and X that you authorise, stored encrypted (AES-256-GCM), plus your public handle. We use them only to publish the posts on your calendar and to check whether a post went out. If you link Telegram, we store your chat id.</li>
        <li><strong>Your content:</strong> notes, links, profile and voice settings, news feeds, and the posts and reviews generated for you.</li>
        <li><strong>Billing:</strong> handled by Stripe. We store your Stripe customer id and subscription status, never your card details.</li>
        <li><strong>Usage:</strong> basic logs (for example sign-in attempts, errors and the number of AI calls) to run, secure and bill for the Service.</li>
        <li><strong>Sign-in:</strong> a cookie (<code>pf_session</code>, up to 30 days) keeps you signed in. Your light or dark theme choice is kept in your browser&apos;s local storage and never sent to us.</li>
        <li><strong>How you found us:</strong> a small cookie (<code>pf_src</code>, kept 30 days) remembers which site or shared link you came from, for example &quot;reddit&quot;. If you sign up or join the waitlist, that label is saved with your account. It holds no personal details.</li>
        <li><strong>Visitor statistics:</strong> Cloudflare Web Analytics counts page visits, the referring site, country and device type. It sets no cookies and does not track you across sites.</li>
      </ul>
      <h2>How we use it</h2>
      <p>To provide the Service (write, review, schedule and publish your posts), to send account emails (confirmation, password reset, important notices), to process payments, to prevent abuse, and to improve reliability. We do not sell your data and do not use your content to train AI models.</p>
      <h2>Service providers</h2>
      <p>We share data only with providers that help run PostFlow, under their own privacy terms: Netlify (hosting), our database host, Cloudflare (visitor statistics), Stripe (payments), Google Gmail or Resend (email), Fireworks AI (text generation; your notes and source material are sent to generate and review drafts), Google (if you sign in with Google), LinkedIn and X (publishing), and Telegram (if you link it).</p>
      <h2>Where it is processed</h2>
      <p>These providers may process data outside your country, including in the United States and the European Union. Where the law requires it, transfers rely on the providers&apos; standard contractual clauses or equivalent safeguards.</p>
      <h2>Retention and deletion</h2>
      <p>Activity logs are deleted after 90 days and AI usage records after 180 days. We keep the rest of your data while your account exists. Deleting your account (Account page) cancels your subscription and permanently deletes your notes, posts, settings, feeds and stored tokens. Billing records are kept by Stripe as required by law. You can disconnect LinkedIn, X or Telegram at any time in Settings.</p>
      <h2>Your rights</h2>
      <p>Depending on where you live, you may have the right to access, correct, export or delete your personal data, and to object to some processing. Contact us to make a request; we answer within 30 days. If you are in the EU or UK, you can also complain to your data protection authority. The legal bases we rely on are performing our contract with you, our legitimate interest in keeping the Service secure, and the same interest for cookie-free visit counts.</p>
      <h2>Security</h2>
      <p>Connections use HTTPS, passwords are hashed, platform tokens are encrypted at rest, and sessions are signed. No system is perfectly secure; tell us right away if you suspect a problem.</p>
      <h2>Contact</h2>
      <p>{contact ? <>Privacy questions: <a href={`mailto:${contact}`}>{contact}</a>.</> : "Privacy questions: reply to any email from us."}</p>
    </LegalShell>
  );
}
