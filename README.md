# PostFlow

A subscription service that runs LinkedIn and X on autopilot for its customers. For each account it keeps a calendar filled a few days ahead with posts about **their work**, **tech news with their take**, **their local tech scene** and **evergreen lessons**. A separate reviewer agent checks every draft before it is scheduled, and nothing is published until the customer approves it (or, on Pro, switches to auto mode).

Customers sign up with email and password or Google, confirm their email, start a 7-day trial through Stripe Checkout, connect their own LinkedIn and X accounts, and optionally link Telegram. Every row in the database belongs to one account, and every query is scoped to the signed-in account (see `src/server/context.ts` and `tests/tenancy.test.ts`).

```
every 5 min (cron)  ──►  /api/cron/tick
                           1. publish anything due          (always first)
                           2. collect RSS feeds
                           3. score new items for relevance + urgency
                           4. fill empty calendar slots:  pick material → write → REVIEW → schedule
                           5. Telegram: "scheduled: <text>  [Remove]"
```

## What makes it safe to leave on autopilot

- **Reviewer gate.** A second model pass scores *worth posting*, *factual accuracy* and *AI-slop*, and extracts every checkable claim, marking each supported / unsupported / unverifiable against the source text. The pass/fail decision is made by code thresholds, not by the model. Failed drafts are rewritten with the reviewer's notes (max 3 rounds) or rejected and never scheduled. Rejections stay visible in the app.
- **Deterministic checks on top:** length limits (X counts links as 23 chars), banned cliché phrases, hashtag/emoji/question caps, near-duplicate detection against recent posts.
- **No invented experience.** First-person claims are only allowed when they come from *your* notes. News posts must attribute the source. Evergreen posts stay inside your stated expertise and use well-known facts only.
- **You can veto anything**: remove from the calendar (web or Telegram button), edit, move, or pause everything with one switch (`/pause` in Telegram too). Removed slots are not refilled.
- **Time-sensitive news** gets an expiry (breaking: 48 h, this-week: 7 days). It takes the earliest suitable slot (displacing an unedited evergreen post if needed), at most one per platform per day so your own posts still get slots, and is *dropped, not posted late* if it goes stale.
- **Opportunity, not recap.** News is scored on whether it opens something for builders (an API turning free, a platform opening to agents, a pricing or policy shift, a market gap), and posts are written as: what changed, why it is an opening (who benefits, what could be built, why now), one concrete next step. Opportunity claims are framed as your opinion, and the reviewer rejects predictions stated as fact.
- **Fast lane.** A rare, clearly actionable breaking story (score 9+, under 12 hours old) gets an extra post about 45 minutes out, outside your normal slots, so you still get a Telegram Remove button and time to veto. Limited to one per platform per day, never inside quiet hours (23:00-07:00 by default), configurable in Settings.
- **No double posting.** Row-locked claims, a one-live-post-per-slot index, and ambiguous results (timeouts, 5xx, crashes) become *unconfirmed* instead of being retried. X posts are auto-reconciled against your timeline; LinkedIn can't be read back, so you confirm in the app.
- Fetched articles are treated as untrusted data; model output is schema-validated and can't trigger actions. A daily model-call cap (`MAX_LLM_CALLS_PER_DAY`) bounds cost.

**Limit to know about:** the fact-checker can only verify against the article text or your note it was given (no live web search). Skim the calendar daily; it is a queue, not a black box.

## Using it

1. **Notes** (web or Telegram): drop rough notes about what you built or learned. This is the highest-quality input and how your voice shows up.
2. **Calendar**: skim the week. Click a post to read the reviewer's reasoning and claim-by-claim evidence, edit it, move it or remove it.
3. **Settings**: slots (`linkedin mon-fri 09:15`, `x daily 19:30`), content mix, voice, topics, feeds.

Telegram: send any text = note (`#local`, `#learning` tags steer it), `/queue`, `/pause`, `/resume`.

## Pages

| URL | What | Who |
| --- | --- | --- |
| `/` | Landing page: product tour, pricing, FAQ, then sign-up (or waitlist while `SIGNUPS_OPEN` is not `true`) | everyone |
| `/signup`, `/login`, `/forgot`, `/reset`, `/verify-email` | Accounts: email + password or Google | everyone |
| `/billing` | Pick a plan (Stripe Checkout with a 7-day trial), or manage it (Stripe portal) | signed in |
| `/account` | Change password, sign out everywhere, delete account | signed in |
| `/calendar`, `/posts/…`, `/create`, `/notes`, `/settings` | The app | active subscription or owner |
| `/admin` | Accounts, plans, estimated MRR, model usage, waitlist, system checks | owners only (`OWNER_EMAILS`) |
| `/terms`, `/privacy` | Legal pages (templates: have them reviewed) | everyone |

**Plans** live in `src/lib/pricing.ts`: prices, posts per month, feeds, model calls per day, and which features each plan has (auto mode, fast lane, posts from links). The landing page, the billing page and the server-side limits all read from that one file.

**You, the owner** never pay: any email in `OWNER_EMAILS` gets every feature, no billing, and the Admin page. The first time an owner email signs in, it takes over the data from the single-user version (your existing posts, notes, feeds and connected accounts).

## Deploying on Netlify

| Piece | Service | Cost |
| --- | --- | --- |
| Web app, API, landing page | Netlify | free tier to start |
| Scheduler (every 5 min) | Netlify scheduled + background function (`netlify/functions/`) | see note below |
| Database | Neon or Supabase Postgres | free tier to start |
| Payments | Stripe | 2.9% + 30¢ per charge (plus Stripe Tax / Billing fees if enabled) |
| Email | Resend | free up to 3,000 emails/month |
| Model | Fireworks | pay per use (yours, for all customers) |
| LinkedIn API | one developer app for all customers | free |
| **X API** | one developer app for all customers | **paid per post, billed to you**; check current pricing |
| Alerts + notes | one Telegram bot for all customers | free |

1. **Database.** Create a Neon database; put the pooled connection string in `DATABASE_URL` and run `npm run db:migrate` once locally against it (again after every update that adds a migration).
2. **Netlify.** Add new site → Import an existing project → this repo. `netlify.toml` already sets the build and Node 22. Add every variable from `.env.example` under Site configuration → Environment variables. Set `APP_URL` to your Netlify URL or custom domain, and `OWNER_EMAILS` to your email. Deploy.
3. **Sign in as the owner** at `/signup` (or with Google) using your `OWNER_EMAILS` address. You land in the app with your old data.
4. **Email.** No domain? Use Gmail: turn on 2-Step Verification, create an app password at myaccount.google.com/apppasswords, and set `GMAIL_USER` and `GMAIL_APP_PASSWORD` (about 500 emails a day). With a domain, use Resend instead: verify the domain, set `RESEND_API_KEY` and `EMAIL_FROM`.
5. **Stripe** (start in test mode):
   - Set `STRIPE_SECRET_KEY`, then run `npm run stripe:setup` once. It creates the Starter and Pro products with monthly and yearly prices from `pricing.ts` (re-run it after changing prices).
   - Developers → Webhooks → add endpoint `{APP_URL}/api/stripe/webhook` with events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
   - Settings → Billing → Customer portal: allow cancelling, updating payment methods and switching between the Starter and Pro products, then save.
   - Optional: turn on Stripe Tax so VAT/sales tax is added at checkout.
6. **Google sign-in** (optional): create an OAuth client (Web application) with redirect `{APP_URL}/api/auth/google/callback`, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Google asks for your privacy policy URL (`{APP_URL}/privacy`) when you publish the consent screen.
7. **LinkedIn and X apps**: one each, for all customers (see below). On X you pay per post, which is why plans cap posts per month and customers cannot add links to X posts.
8. **Telegram** (optional): create one bot with @BotFather, set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` and `TELEGRAM_WEBHOOK_SECRET`, redeploy, then press **Register Telegram webhook** on `/admin`. Customers press **Connect Telegram** in Settings.
9. **Open the doors**: check `/admin` → System (everything green), test a full sign-up with a Stripe test card (`4242 4242 4242 4242`), then set `SIGNUPS_OPEN=true` and switch Stripe to live keys.

**Scheduler on Netlify.** A normal Netlify request is cut off after about 30 seconds, but one scheduler pass (publish for everyone, then write and review for each account in turn) can take minutes. `tick-schedule` runs every 5 minutes and starts `tick-background`, a background function with a 15 minute limit; each pass gives one account at most 90 seconds and serves accounts least-recently-served first. Scheduled functions only run on the production deploy. Check that background functions are included in your Netlify plan; if not, run `npm run tick` from GitHub Actions or any always-on machine (`npm run tick:loop`) with the same environment variables.

### Connecting accounts

**LinkedIn:** create one app for PostFlow at linkedin.com/developers (needs a LinkedIn Page you administer), add products *Share on LinkedIn* and *Sign In with LinkedIn using OpenID Connect*, add redirect `${APP_URL}/api/oauth/linkedin/callback`. Scopes: `openid profile w_member_social`.

**X:** create one project/app for PostFlow at developer.x.com, enable OAuth 2.0 with *Read and write*, callback `${APP_URL}/api/oauth/x/callback`. Scopes: `tweet.read tweet.write users.read offline.access`.

**Platform rules:** LinkedIn's API terms restrict "automating posting" and X restricts automated or bot-like behaviour. Posting your own reviewed content to your own account through the official APIs, with a human veto, is the intended shape of this tool, but read both sets of terms and decide for yourself. PostFlow never likes, comments, follows or messages.

## Local development

```bash
npm install
# Postgres on :54329 (scripts/db.sh, run as a non-root user), then:
cp .env.example .env     # fill it in
npm run db:migrate
npm run dev              # app on :3000
npm run tick:loop        # local scheduler (instead of cron)
npm test                 # Postgres-backed tests with fake model and fake platforms
```

## Layout

| Area | Where |
| --- | --- |
| Schema / migrations | `src/server/db/schema.ts`, `drizzle/` |
| Tick orchestration | `src/server/tick.ts` |
| Feed collection, scoring | `collect.ts`, `analyze.ts` |
| Material choice, writer, reviewer, gate, planner | `generate.ts`, `prompts.ts`, `checks.ts` |
| Slots / timezone math | `slots.ts` |
| Publisher, retries, reconciliation | `publisher.ts` |
| Owner actions (edit, remove, reschedule) | `posts.ts` |
| Telegram | `telegram.ts`, `telegram-inbound.ts` |
| LinkedIn / X clients, OAuth | `platforms/` |
| Current-user context (every query is scoped by it) | `context.ts` |
| Accounts, email links, Google, owner claim | `users.ts`, `auth.ts`, `google.ts`, `email.ts` |
| Plans, limits, entitlement | `src/lib/pricing.ts`, `billing/plans.ts` |
| Stripe checkout, portal, webhook | `billing/stripe.ts`, `src/app/api/stripe/webhook/` |
