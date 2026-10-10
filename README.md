# PostFlow

A personal discovery, research, drafting and publishing desk. It finds developments worth your attention and explains why they matter. When you choose a topic, it researches it and drafts separate LinkedIn and X posts. Nothing is published without your approval of the exact text.

**Discover automatically. Research intelligently. Draft thoughtfully. You decide what gets published and when.**

## Daily use (the whole workflow)

1. **Home → Today's ideas.** Scan the list. Press **Write post** on anything worth sharing and **Skip** the rest. "Why this, and sources" expands the details.
2. **Review.** The LinkedIn and X versions open side by side. Edit the text, or use a one-click rewrite (Shorter, More analytical, **More creative**, or type an angle).
3. **Make it engaging.** The **Format** row rewrites the post as a *What if…*, *Contrarian*, *3 takeaways*, *Quote + take* or *One question* post. **Make carousel** turns a LinkedIn draft into 7–9 rendered slides. **Images** lets you render a stat/quote/list/headline card in your theme, reuse the article's own preview image, or generate decorative art (paid, off by default) — the image is bound to that revision, so approving covers the exact text *and* the exact picture.
4. Press **Approve & schedule · <suggested time>**, or **Post now**. Under **More** you can pick your own time or approve without scheduling.
5. **Calendar** shows what goes out when. Open any post to reschedule or unschedule it.
6. **Scorecard** shows what earned likes, reposts, replies and impressions, by format. X numbers refresh automatically every ~6 hours; LinkedIn numbers you type in from the post's analytics.

**Found an article yourself?** Open **Intake**, paste a link or the full text. It is distilled into *atoms* — numbers, quotes, insights, contrarian points — and you pick which atoms a post is built from. Your own writing is first-class here: drafts inherit your perspective instead of the article's.

Press **Find new ideas** to check your sources again. Discovery also runs automatically at the times set in Settings.

## Quick start

```bash
npm install                 # uses ./.npm-cache (see .npmrc)
npm run db:start            # Postgres cluster stored in ./.data/pg, port 54329
npm run db:migrate
npm run db:seed             # owner user, default preferences, source set (44 defined: AI news + builder signal, 27 enabled)
cp .env.example .env        # then fill in (see below); a filled .env may already exist
npm run build && npm start  # web app on http://localhost:3000
npm run worker              # in a second terminal: discovery + publishing

npm run desk                # …or just this: web app + worker together (Ctrl-C stops both)
npm run doctor              # checks everything: env, DB, AI model, sources, accounts, worker
npm run mcp                 # optional: MCP stdio server (drafts only, never approves/publishes)
npm run shot -- --out ./shots  # optional: full-page screenshots of the running app (headless, signed in)
```

`.env` essentials:

| Variable | Purpose |
| --- | --- |
| `APP_PASSWORD_HASH` | `npm run hash-password -- 'your password'` |
| `SESSION_SECRET` | 32+ random chars (`openssl rand -base64 48`) |
| `TOKEN_ENCRYPTION_KEY` | 32 bytes base64 (`openssl rand -base64 32`): encrypts OAuth tokens at rest |
| `FIREWORKS_API_KEY`, `FIREWORKS_MODEL` | Required for analysis, research and drafting. Choose a current model id from fireworks.ai/models |
| `FIREWORKS_RESEARCH_MODEL` | Optional stronger model for research and drafting |
| `FIREWORKS_PRICE_INPUT_PER_M`, `FIREWORKS_PRICE_OUTPUT_PER_M` | Optional, from your Fireworks pricing page. Enables USD estimates and the USD budget |
| `GITHUB_TOKEN` | Optional, raises GitHub API rate limits |
| `LINKEDIN_CLIENT_ID/SECRET`, `X_CLIENT_ID/SECRET` | Optional, enables publishing |

Without Fireworks the app still collects and keyword-ranks discoveries. Without social accounts, research and drafting still work. Publishing fails visibly; it never pretends to succeed.

## How it works

```
worker (tsx)                               web (Next.js)
├─ discovery at configured local times  ◄──  "Run discovery" queues a job_runs row
│   collect → normalize → dedupe/group → filter → prefilter
│   → LLM batch analysis (cached) → deterministic score → briefing
├─ publishDue every 20s (row-locked claim, approval re-verified)
├─ reconcile every 60s (ambiguous results, crashed attempts)
└─ flagStale every 10m (time-sensitive posts → needs review)
```

Everything is in one TypeScript codebase: a modular monolith plus a worker process. PostgreSQL holds all state, including the job queue (`FOR UPDATE SKIP LOCKED`). Redis and BullMQ were not needed at this volume. Restarting the worker is safe.

| Area | Where |
| --- | --- |
| Schema and migrations | `src/server/db/schema.ts`, `drizzle/` (Drizzle ORM) |
| Draft state machine and platform validation | `src/server/drafts/state.ts` |
| Approval, scheduling, cancel and retry | `src/server/drafts/service.ts` |
| Quality validator (slop phrases, near-duplicates) | `src/server/drafts/validator.ts` |
| Slot rules and suggestions (timezone and DST) | `src/server/scheduling/rules.ts` |
| Publisher, reconciliation and staleness | `src/server/publishing/publisher.ts` |
| X and LinkedIn clients, OAuth | `src/server/platforms/` |
| Intake: article extraction and atom mining | `src/server/intake/` |
| Card / carousel / OG image engine (satori + sharp) | `src/server/images/`; fonts in `assets/fonts/` |
| Voice profile (your approved posts as style examples) | `src/server/voice.ts` |
| Metrics collection and scorecard | `src/server/metrics.ts` |
| Fireworks provider, cache, budget | `src/server/llm/index.ts`; prompts are in `llm/prompts.ts` |
| Discovery pipeline | `src/server/discovery/` |
| Ranking (weights, caps, penalties) | `src/server/discovery/scoring.ts` |
| MCP server (drafts-only) | `mcp/server.ts` |

### Guarantees the code enforces

- **Approval belongs to a revision.** Revisions are immutable. Editing creates a new revision, revokes the approval, and cancels any pending schedule. Right before sending, the worker re-checks that the scheduled revision, the approval and the content hash all match.
- **Images are part of the revision.** The content hash covers the text, the format tag and the exact image ids, so swapping a card or slide demands a fresh approval. Media files are served only to you (`/api/media/<id>`, session-checked).
- **Drafts are never published by a model.** The MCP surface can list, read and draft, but there is no approve or publish tool anywhere in it. Publishing is only ever your click in the UI, and the worker re-verifies everything first.
- **Platforms are independent.** Each platform has its own drafts, approvals, schedules, limits, windows and pause switch. Approving the LinkedIn version never touches the X version.
- **No double posting.** Claims use row locks and an attempt row is written before the API call. Unique indexes block two live schedules per draft and identical text twice on one platform.
- **Ambiguous results are never blindly retried.** A timeout, a 5xx or a worker crash puts the post in the "unconfirmed" state. On X, the reconciler looks for the post on your timeline. On LinkedIn, the member-posting API can't read your posts back, so you confirm in the UI.
- **Stale news isn't published late.** Time-sensitive posts carry a freshness horizon. Once it passes, the post is held for review instead of being published.
- **Fetched content is untrusted.** It is wrapped in delimiters and the model has no tools. Model output is schema-validated and can't trigger any action. Article fetching refuses private-network URLs.
- **Ranking is explainable.** The model scores relevance, evidence, insight and audience (0–5). Recency, evidence caps, repeat-topic penalties and the weighted total are computed by plain code. Each score is stored with its version and weights.

## Tests

```bash
npm test     # 72 tests against the postflow_test database
```

They cover approval enforcement, independent platform queues, Kathmandu timezone and US DST handling, limits and suggestions, URL normalization, deduplication and grouping, scoring and briefing, retries, ambiguous-result reconciliation, crash recovery, LLM caching, budgets and malformed output, the quality validator, card-form parsing, X cost estimates, and intake extraction.

## Before you connect real accounts (verify these yourself)

Both platforms require you to create a developer app once. **Step-by-step instructions: [SETUP.md](SETUP.md).** In short:

- **LinkedIn:** create an app at linkedin.com/developers and add the products *Sign In with LinkedIn using OpenID Connect* and *Share on LinkedIn*. Scopes are `openid profile w_member_social`. Posting uses `POST /v2/ugcPosts`. Register `${APP_URL}/api/oauth/linkedin/callback`.
- **X:** create an app in the developer console with OAuth 2.0 (PKCE) and read+write permission. Scopes are `tweet.read tweet.write users.read offline.access`. Posting uses `POST /2/tweets`. Register `${APP_URL}/api/oauth/x/callback`. **Check your access tier and per-post pricing first**, because X API pricing changes often.
- Model ids and prices are never hard-coded. Pick them from the current Fireworks docs.
- Run `npm run doctor` after each step; it tells you exactly what is still missing.

## Known limitations / next steps

- **LinkedIn metrics are manual.** The member-posting API can't read your posts back, so you type likes/comments in from the post's analytics. X collects automatically (`X_*` keys must be set; the collector refreshes every ~6 hours).
- Card images render in one theme (dark, Inter). More themes would be a small change to `src/server/images/render.tsx`.
- No drag-and-drop on the calendar. You reschedule from the post's panel instead, which avoids accidental moves.
- "Research a topic" draws on your library, Hacker News search and GitHub search. There is no general web-search API.
- Paid AI image generation (BFL or OpenAI) is decorative-only and off unless you set `BFL_API_KEY` or `OPENAI_API_KEY`. It is never used for cards or slides, which are rendered locally for free.
- The login rate limiter lives in memory, which suits a single instance. Back up `./.data/pg` regularly with `pg_dump -h localhost -p 54329 -U postflow postflow`.
