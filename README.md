# PostFlow

Autopilot for a personal LinkedIn and X presence. It keeps a calendar filled a few days ahead with posts about **your work**, **tech news with your take**, the **Nepal tech scene** and **evergreen lessons**. A separate reviewer agent checks every draft before it is scheduled. Posts go out on schedule **unless you remove them from the calendar**.

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

Telegram: send any text = note (`#nepal`, `#learning` tags steer it), `/queue`, `/pause`, `/resume`.

## Pages

| URL | What | Who |
| --- | --- | --- |
| `/` | Public landing page: product tour, pricing, FAQ, early-access form | everyone |
| `/login` | Owner sign-in | you |
| `/calendar`, `/posts/…`, `/create`, `/notes`, `/settings` | The app | you |

Early-access sign-ups land in the `waitlist` table and are listed at the bottom of **Settings**. Plans and prices live in `src/lib/pricing.ts`. Landing screenshots are real app screenshots in `public/landing/` (light and dark).

## Deploying on Netlify (about 20 minutes)

| Piece | Service | Cost |
| --- | --- | --- |
| Web app, API, landing page | Netlify | free tier to start |
| Scheduler (every 5 min) | Netlify scheduled + background function (`netlify/functions/`) | see note below |
| Database | Neon or Supabase Postgres | free |
| Alerts + notes | Telegram bot | free |
| Model | Fireworks | pay per use (small) |
| LinkedIn API | developer app | free |
| **X API** | developer app | **paid per post; check current pricing before relying on it** |

1. Create a Neon database; put the pooled connection string in `DATABASE_URL` and run `npm run db:migrate` once locally with it (run it again after every update that adds a migration).
2. In Netlify: **Add new site → Import an existing project →** pick this repo. `netlify.toml` already sets the build command and Node 22.
3. **Site configuration → Environment variables:** add every variable from `.env.example`. Set `APP_URL` to your Netlify URL (or custom domain), e.g. `https://postflow.netlify.app`.
4. Deploy. The landing page is at `/`, sign in at `/login`.
5. In **Settings** inside the app: connect LinkedIn and X, register the Telegram webhook, set your profile and slots.

**Scheduler on Netlify.** A normal Netlify request is cut off after about 30 seconds, but one scheduler pass (collect, write, review, publish) can take minutes. So `tick-schedule` runs every 5 minutes and starts `tick-background`, a background function that may run for up to 15 minutes. Scheduled functions only run on the production deploy. Check that background functions are included in your Netlify plan. If they are not, run the scheduler from GitHub Actions instead (`npm run tick` with the same environment variables as repo secrets) or from any always-on machine with `npm run tick:loop`. Pinging `/api/cron/tick` from cron-job.org also works, but only for passes that finish within Netlify's request limit.

### Connecting accounts

**LinkedIn:** create an app at linkedin.com/developers (needs a LinkedIn Page you administer), add products *Share on LinkedIn* and *Sign In with LinkedIn using OpenID Connect*, add redirect `${APP_URL}/api/oauth/linkedin/callback`. Scopes: `openid profile w_member_social`.

**X:** create a project/app at developer.x.com, enable OAuth 2.0 with *Read and write*, callback `${APP_URL}/api/oauth/x/callback`. Scopes: `tweet.read tweet.write users.read offline.access`.

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
