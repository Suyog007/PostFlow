# Automating Social Posting and Engagement on LinkedIn and X (2026): Official Rules, API Access, Costs, Ban Risks, and the Engagement-Farming Line

Research conducted October 2026. Scope: what a self-hosted "automation desk" (drafts AI/tech posts → human approval → posts to the user's own accounts) may and may not safely do. Official platform policies are cited first; community/vendor claims are explicitly labeled. Note: help.x.com and help.linkedin.com block direct fetches; X Help pages were retrieved via Wayback Machine captures from October 2026 and the canonical live URLs are given alongside.

---

## Key Question 1: What do X's Developer Agreement / Automation Rules and LinkedIn's User Agreement / API Terms say about automated posting, automated replies/likes/follows, and scheduling tools?

### Takeaway
Both platforms allow API-based automated posting to your own account, but X requires consent, no duplicative/spammy behavior, and explicitly bans non-API automation (website scripting) and automated likes/bulk follows; LinkedIn's User Agreement bans bots and "unauthorized" automation of create/comment/like/share and must be read together with its API Terms, whose Section 3.1(26) states you may not "Use the Content or the APIs to automate posting on the LinkedIn Services" — a clause that sits uneasily with LinkedIn's own Share-on-LinkedIn product and needs legal interpretation.

### Cited Findings

**X — Developer Agreement (last updated April 27, 2026):**
- The Agreement incorporates by reference the "Automation Rules" for developers "taking automated actions on your account" — [X Developer Agreement](https://developer.x.com/en/developer-terms/agreement) — [Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)
- Rate limits cannot be exceeded or circumvented; violation may cause temporary suspension or permanent block of API access — [X Developer Agreement, §III.D](https://developer.x.com/en/developer-terms/agreement)
- API keys/credentials may never be shared with third parties — [X Developer Agreement, §III.G](https://developer.x.com/en/developer-terms/agreement)
- Self-serve plans (referred to as "Pay-Per-Use, Basic, and Pro" in the April 2026 text) are for hobbyists, commercial prototyping, early-stage integrations, and "applications with a limited number of end-users"; beyond that scope an Enterprise plan must be applied for — [X Developer Agreement, §III.L/M](https://developer.x.com/en/developer-terms/agreement)
- X may suspend immediately if it believes there is inordinate burden, violation, or unviable economics; X may terminate the Agreement "for any reason at X's sole discretion" — [X Developer Agreement, §VII.H/I](https://developer.x.com/en/developer-terms/agreement)

**X — Developer Policy (write actions):**
- Services that post, follow, or send DMs "must follow the Automation Rules"; specifically: always get explicit consent before automated replies or DMs; immediately honor opt-outs; never do bulk/aggressive/spammy actions including bulk following; never post identical or substantially similar content across multiple accounts — [X Developer Policy](https://developer.x.com/en/developer-terms/policy)
- Before publishing on a user's behalf, a service must "show exactly what will be published"; if cross-posting to your service and X, it must obtain permission and explain where content will be posted; authenticating alone is not consent — [X Developer Policy — Consent & permissions](https://developer.x.com/en/developer-terms/policy)
- API-based bot accounts must clearly indicate that they are bots and who is responsible — [X Developer Policy](https://developer.x.com/en/developer-terms/policy)
- "Pay to engage": services may not sell or receive monetary or virtual compensation for X actions (posts, follows, likes, replies, etc.) — [X Developer Policy](https://developer.x.com/en/developer-terms/policy)

**X — Automation Rules (page updated April 2026):**
- "Do": build solutions that auto-broadcast helpful information; run campaigns that auto-reply to users who engage; auto-respond to DMs — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation) (fetched via [Wayback capture, Oct 1, 2026](https://web.archive.org/web/20261001071835/https://help.x.com/en/rules-and-policies/x-automation))
- "Don't": "Use non-API-based forms of automation, such as scripting the X website. The use of these techniques may result in the permanent suspension of your account." — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)
- Automated posts based on outside sources (e.g., RSS, weather) are allowed if you are authorized to publish the info; automated posts "for entertainment, informational, or novelty purposes" are allowed; duplicative/spammy content may be suspended — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)
- You may not automatically post about trending topics or use automation to influence trends — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)
- No duplicative/substantially similar posts "on one account or over multiple accounts you operate"; no automating multiple accounts for duplicative use cases (localization excepted) — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)
- Automated replies/mentions are allowed ONLY if: the recipient requested/clearly indicated intent beforehand (opt-in), there is a clear opt-out that is honored, only one automated reply/mention per user interaction, and it replies to the user's original post — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)
- "Sending automated replies to posts based on keyword searches alone is not permitted." — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)
- AI-powered automated reply bots "require prior written and explicit approval from X" — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)
- Automated DMs: not allowed in a bulk/unsolicited manner; only to users who opted in, with opt-out honored — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)
- "You may not like posts or hide replies in an automated manner." — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)
- Automated reposts/quote posts allowed for entertainment/informational/novelty purposes; bulk/aggressive/spammy reposting is a violation — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)
- Automated follow/unfollow "in a bulk, aggressive, or indiscriminate manner" prohibited; bulk list additions prohibited — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)
- Advertisers/publishers/brands running auto-response campaigns "must request approval from X" — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)
- User responsibility: "You are ultimately responsible for the actions taken with your account, or by applications associated with your account"; platform may filter posts from search or suspend the account — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)

**Scheduling tools (X):** No rule prohibits time-delayed publishing by itself; the constraints are on duplication, trending-topic automation, spam, and non-API automation. A scheduler that publishes human-approved, non-duplicative posts through the API with the poster's consent fits the "Do" list (auto-broadcast helpful information) — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation); [X Developer Policy](https://developer.x.com/en/developer-terms/policy).

**LinkedIn — User Agreement (effective November 3, 2025):**
- §8.2 "Don'ts" prohibits: developing/using software, scripts, robots etc. to scrape or copy the Services; using "bots or other unauthorized automated methods to access the Services, add or download contacts, send or redirect messages, create, comment on, like, share, or re-share posts, or otherwise drive inauthentic engagement"; bypassing access controls/use limits; placing unreasonable load on the services or manipulating algorithms — [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement)
- LinkedIn "reserves the right to restrict, suspend, or terminate your account" for breaches and can remove content — [LinkedIn User Agreement, §3.4](https://www.linkedin.com/legal/user-agreement)
- One account, real name; accounts cannot be shared; you are responsible for activity on your account — [LinkedIn User Agreement, §2.1–2.2](https://www.linkedin.com/legal/user-agreement)

**LinkedIn — Help Center enforcement pages:**
- "We don't allow the use of third-party software or browser extensions that scrape, modify the appearance of, or automate activity on LinkedIn's website"; accounts restricted for automated activity should disable the software and wait out the suspension; appeals possible — [Automated activity on LinkedIn (updated ~Oct 2026)](https://www.linkedin.com/help/linkedin/answer/a1340567)
- "Prohibited software and extensions": users of such tools "risk having their accounts restricted or shut down" and tools "may become non-operational without notice"; LinkedIn "constantly works to improve … defenses against the operation of scraping, automation, and other tools" — [Prohibited software and extensions](https://www.linkedin.com/help/linkedin/answer/56347)

**LinkedIn — API Terms of Use (last revised December 13, 2022; still in force as of Oct 2026):**
- Self-Serve API Program eligibility: app must help members "be more productive and successful" (example given: "augmenting their profile and professional brand in an Application for publishing, discussing and sharing content"), must not use content for advertising, must have <100,000 lifetime users, must not rely on the APIs as a fundamental aspect of the business, max ~100,000 calls/day — [LinkedIn API Terms of Use, §1.4](https://www.linkedin.com/legal/l/api-terms-of-use)
- Section 3.1(26) states the developer agrees not to "[u]se the Content or the APIs to automate posting on the LinkedIn Services." — [LinkedIn API Terms of Use, §3.1](https://www.linkedin.com/legal/l/api-terms-of-use) (verified on both [developer.linkedin.com/legal/api-terms-of-use](https://developer.linkedin.com/legal/api-terms-of-use) and the canonical [linkedin.com/legal/l/api-terms-of-use](https://www.linkedin.com/legal/l/api-terms-of-use), Oct 2026)
- Other relevant §3.1 restrictions: no scraping-derived ("Non-Official") content (24); no combining content with non-official content (25); no circumventing call limits or creating multiple apps for similar uses (20); no storing content except tokens/consented profile data (Section 4); consent required before accessing member content (§5.2); APIs "currently provided for free" but LinkedIn reserves the right to charge (§8.2) — [LinkedIn API Terms of Use](https://www.linkedin.com/legal/l/api-terms-of-use)
- LinkedIn may audit the app and "restrict or terminate your access to the APIs" if compliance isn't demonstrated (§7.2); may suspend/terminate "at any time for any reason" (§11.3) — [LinkedIn API Terms of Use](https://www.linkedin.com/legal/l/api-terms-of-use)
- In parallel, LinkedIn's official developer product catalog markets "Share on LinkedIn" — "Amplify your content by sharing it on LinkedIn" — which lets a member-authorized app create posts (text, URL, image) on the member's behalf — [LinkedIn Developer Product Catalog — Consumer](https://developer.linkedin.com/product-catalog); [Share on LinkedIn docs](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin)

### Inferences
- The two LinkedIn documents pull in opposite directions on the exact question of "automated posting": the API Terms' §3.1(26) reads as a blanket prohibition, while LinkedIn's own Share API docs describe creating posts programmatically on the authenticated member's behalf (which is exactly what scheduling tools do). The most plausible reading — requiring confirmation — is that §3.1(26) targets autonomous/unauthorized automation of posting (bots acting without member action), not member-authorized publishing via LinkedIn's sanctioned products, but the text as written is broader and should be treated as legal risk that needs counsel review.
- For X, the rules are unusually explicit and favorable to a human-approved scheduling desk: API-based auto-posting of non-duplicative content is allowed; anything involving likes, bulk follows, keyword-triggered replies, unapproved AI reply bots, or non-API automation is not.
- Both platforms treat "you are responsible for what your authorized apps do" as a core principle, so using an automation desk does not transfer risk away from the user's account.

### Gaps
- No official LinkedIn clarification was found reconciling API Terms §3.1(26) with the Share on LinkedIn product; interpretation is unresolved.
- Whether LinkedIn's Developer Portal grants "Share on LinkedIn" (w_member_social) instantly or with review in 2026 is not stated in the fetched docs (the docs only say to add the product in the portal).
- help.x.com and help.linkedin.com pages were partially inaccessible to direct fetch (403); X policy text was verified through October 2026 Wayback captures, and users should re-verify against live pages.

---

## Key Question 2: X API tiers/pricing in 2026 for posting text, uploading media, and reading metrics; which auth is needed?

### Takeaway
X has replaced subscription tiers with pay-per-usage credits in 2026: creating a text post costs $0.015/request, a post containing a URL costs $0.20/request, media upload is billed at $0.005/request, post reads are $0.005/resource ($0.001 for "Owned Reads" of your own account's data), and metrics endpoints are $0.005–$0.01/request. Posting and media upload require user-context auth — either OAuth 1.0a or OAuth 2.0 PKCE with `tweet.write` (and `media.write` for media); app-only bearer tokens cannot post.

### Cited Findings
- "The X API uses pay-per-usage pricing. No subscriptions—pay only for what you use." Credits are purchased in the Developer Console and deducted as requests are made; per-endpoint rates apply — [X API pay-per-usage pricing](https://docs.x.com/x-api/getting-started/pricing)
- Write prices: Post: Create **$0.015/request**; Post: Create (with URL) **$0.200/request**; Post: Create (summoned) **$0.010**; DM Interaction Create $0.015; User Interaction Create $0.015 (follows etc.); Interaction Delete $0.010; Content: Manage $0.005; **Media Metadata $0.005**; Counts: Recent **$0.005**; Counts: All **$0.010**; Trends $0.010 — [X API pricing, Write operations](https://docs.x.com/x-api/getting-started/pricing)
- Read prices (per resource returned): Posts **$0.005**; Users $0.010; DM events $0.010; Following/Followers $0.010; Likes/Mutes/Blocks $0.001; List/Space/Community $0.005 — [X API pricing, Read operations](https://docs.x.com/x-api/getting-started/pricing)
- "Owned Reads" — reading your own account's posts, mentions, likes, bookmarks, followers, following, lists — is **$0.001/resource** ($1 per 1,000 resources) — [X API pricing, Owned Reads](https://docs.x.com/x-api/getting-started/pricing)
- Pay-per-usage reads are capped at **3 million Post reads per monthly billing cycle**; higher volume requires an Enterprise plan — [X API pricing](https://docs.x.com/x-api/getting-started/pricing)
- Reads/resources are deduplicated within a 24-hour UTC window — [X API pricing, Deduplication](https://docs.x.com/x-api/getting-started/pricing)
- New payers can get $20 free credits for saving a payment card plus a match of first auto-recharge up to $50; up to 20% back in xAI API credits based on cumulative spend ($200→10%, $500→15%, $1,000+→20%); spending limits and auto-recharge available — [X API pricing](https://docs.x.com/x-api/getting-started/pricing)
- The platform overview markets "Credit-based pricing with no commitments" with an Enterprise tier for "high-volume endpoints, dedicated account management, and custom rate limits" — [X Developer Platform overview](https://docs.x.com/overview)
- The Developer Agreement (April 2026) still references "Pay-Per-Use, Basic, and Pro plans" for hobbyist/limited-end-user use and Enterprise beyond that scope — a legacy/hybrid wording; the pricing page treats pay-per-use as the operative model — [X Developer Agreement §III.L](https://developer.x.com/en/developer-terms/agreement)
- Authentication: OAuth 1.0a user context "allows an authorized X developer App to … perform a X action on behalf of a X account"; OAuth 2.0 Authorization Code Flow with PKCE is the "user context" flow; app-only token accesses only public information (cannot post) — [X authentication overview](https://docs.x.com/fundamentals/authentication/overview)
- OAuth 2.0 scopes include `tweet.write` ("Create and repost on your behalf"), `media.write` ("Upload media, such as photos and videos, on your behalf"), `offline.access` ("Request a refresh token for the app") — [X API media upload endpoint / OpenAPI scope reference](https://docs.x.com/x-api/media/upload-media)
- Media upload (POST /2/media/upload) security: **OAuth2UserToken with `media.write` scope OR OAuth 1.0a UserToken** — [X API media upload endpoint](https://docs.x.com/x-api/media/upload-media)
- Media upload supports `media_category` of tweet_image/tweet_video/tweet_gif for posts — [X API media upload endpoint](https://docs.x.com/x-api/media/upload-media)
- Webhook events (X Activity API) are billed per delivered event (e.g., `post.create` $0.005, `follow.follow` $0.010, `dm.received` $0.010) — [X API pricing, Webhook events](https://docs.x.com/x-api/getting-started/pricing)

### Inferences
- Cost math for a personal automation desk (inference): 20 text posts/month ≈ **$0.30**; add one media upload each ≈ **+$0.10**; link posts are 13× more expensive ($0.20 vs $0.015), so a desk posting 40 links/month would pay ~$8 — link frequency is the main cost lever. Owned Reads for your own metrics are effectively negligible ($0.001/resource). A hobbyist desk should cost well under $5–$10/month.
- The dedup window and Owned Reads pricing (both introduced 2026) strongly favor designs that (a) read your own data only via owned endpoints, and (b) avoid redundant reads.
- Because "Post: Create (with URL)" is so much more expensive, the desk may be tempted to push links into replies or bio — note that X's authenticity rules already frown on link-only/spam patterns, so cost optimization must not drift into policy violations.

### Gaps
- The pricing page does not explain what "Post: Create (summoned)" means (likely agent/API-summoned posts); treat the $0.010 rate as unverified in meaning.
- Media upload's exact billing line item is inferred to be the "Media Metadata $0.005/request" entry; the pricing page does not name /2/media/upload explicitly.
- Rate-limit numbers for POST /2/tweets in 2026 (requests per 15 min/user) were not fetched; the Developer Agreement only states limits exist and must not be circumvented.
- It is not confirmed how the old Free/Basic/Pro tiers map onto pay-per-use access levels (e.g., whether "Free" access still exists for write endpoints).

---

## Key Question 3: What LinkedIn API access exists in 2026 for individual developers to post (text/images) to a personal profile, and to read post analytics? What are the approval requirements?

### Takeaway
Posting to a personal profile is available self-serve through the "Share on LinkedIn" product (`w_member_social` scope; text, URL, image — and video per the docs' recipes) with documented rate limits of 150 requests/day per member and 100,000/day per app. Restating: reading a member's own post analytics is NOT self-serve — `r_member_postAnalytics` (impressions, reactions, comments, shares) and `r_member_profileAnalytics` exist only via the Community Management API, which requires a reviewed application (established business, legal identity, use-case fit, Marketing API Terms) and starts in a restricted Development tier.

### Cited Findings
- Share on LinkedIn: "Add the Share on LinkedIn product which will grant you `w_member_social`" via the Developer Portal's Products tab; `w_member_social` is "Required to create a LinkedIn post on behalf of the authenticated member" — [Share on LinkedIn docs](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin)
- Posting endpoint: "For all shares created on LinkedIn, the request will always be a POST request" to the UGC endpoint (`POST https://api.linkedin.com/v2/ugcPosts`; newer versioned REST APIs also exist under the 2026 li-lms versioning scheme); request body supports `shareCommentary` text with `shareMediaCategory` NONE / ARTICLE (URL) / IMAGE; image/video flows require register-upload → binary upload → create share; visibility CONNECTIONS or PUBLIC — [Share on LinkedIn docs](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin)
- Rate limits: **150 requests/day per Member** and **100,000 requests/day per Application** for the share APIs — [Share on LinkedIn docs, Rate Limits](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin)
- Analytics permissions (2026): `r_member_postAnalytics` — "Retrieve analytics for your posts, including impressions, reactions, comments, and shares" — supported only in API versions from 202506; `r_member_profileAnalytics` — "Retrieve your profile analytics, including number of profile viewers, followers, and search appearances" — from 202504; both are "Member Permission (3-legged)" and available only through the **Community Management API** — [Increasing Access — permission table, updated 2026](https://learn.microsoft.com/en-us/linkedin/marketing/getting-access)
- Community Management API approval: applicants need "an established business" (business email, organization legal name, registered address, website, privacy policy), an established use case aligned with supported solutions (not on the restricted list), and agreement to the Marketing API Terms; LinkedIn reviews each application and may reject — [Community Management API product page](https://developer.linkedin.com/product-catalog/marketing/community-management-api)
- Access tiers: all applications start at **Development tier** (500 API calls/app/24h; 100 calls/member/24h; batch disabled; social-action webhooks disabled); production requires a separate **Standard tier** approval; "LinkedIn reserves the right to review applications and select partners at its discretion" — [Increasing Access — How to Upgrade your Access Tier](https://learn.microsoft.com/en-us/linkedin/marketing/getting-access)
- The Community Management API is described as "Available to all developers approved for Community Management API access" (i.e., apply and be reviewed) — [Increasing Access — product table](https://learn.microsoft.com/en-us/linkedin/marketing/getting-access)
- For individuals, the self-serve consumer products are: Verified on LinkedIn, Sign in with LinkedIn, **Share on LinkedIn**, Live Events, Add to Profile; the marketing/sales/talent/learning APIs are separate programs — [LinkedIn Developer Product Catalog](https://developer.linkedin.com/product-catalog)
- APIs are "currently provided for free," but LinkedIn reserves the right to charge in the future; an app may not charge users incremental fees for API-derived content — [LinkedIn API Terms of Use, §8.2](https://www.linkedin.com/legal/l/api-terms-of-use)
- Versioning caveat: Marketing version 202511 sunsets November 16, 2026; developers are told to migrate to current versioned APIs — [Increasing Access, deprecation notice](https://learn.microsoft.com/en-us/linkedin/marketing/getting-access)

### Inferences
- A personal automation desk can post text/images/videos to the owner's LinkedIn profile through the official self-serve Share API with the owner's OAuth consent, at ≤150 posts/day (far below any human-paced cadence). This is the same sanctioned mechanism scheduling tools use.
- Post/social analytics for a personal profile via API is effectively gated behind the partner-style Community Management API review; for an individual hobbyist desk, the practical options are (a) manually reading analytics in the LinkedIn UI, (b) applying to the Community Management API if operating as a business with a legitimate use case, or (c) going without API analytics. Scraping analytics would violate the User Agreement and API Terms (Non-Official Content rules).
- Because API Terms §1.4(5) says self-serve apps must not "rely on access to the APIs as a fundamental aspect of your business," a monetized automation desk built on the self-serve APIs would fall outside the self-serve eligibility criteria — personal, non-core use is the safe zone.

### Gaps
- Whether adding "Share on LinkedIn" in the portal is instant or reviewed in 2026 is not spelled out in the fetched docs.
- Whether any non-Marketing self-serve endpoint exposes member post analytics (all evidence implies no) — no official statement found that says "no analytics for self-serve member apps" in those words.
- Standard-tier Community Management API pricing (if any) and review timelines are not published; docs only describe the process.
- The current REST Posts API path (`/rest/posts`) vs legacy ugcPosts — exact versioned URL/format for member posts in 2026 was not fetched; implementers should pull the latest li-lms docs.

---

## Key Question 4: In practice, what gets accounts restricted or banned (engagement pods, automated replies/DMs, mass posting, AI-slop floods, duplicate content)? Real incidents.

### Takeaway
The documented enforcement triggers are consistent across both platforms: non-API browser automation and bot-driven engagement (create/comment/like/share), bulk or unsolicited DMs/replies/mentions, duplicated or "copypasta" content, bulk follow/unfollow, engagement pods/coordinated engagement exchange, and algorithmic manipulation. X also explicitly bans automated likes and non-API automation with potential permanent suspension; LinkedIn restricts accounts using third-party automation, and community reports show restrictions even at modest manual volumes (e.g., ~200 connection requests/week) and false positives. AI-slop floods are newly salient in 2026: LinkedIn shipped a "report AI-generated slop" button and prevalence studies claim ~25% of long-form posts on LinkedIn/X appear AI-generated.

### Cited Findings

**Official enforcement language:**
- X: non-API automation (scripting the website) "may result in the permanent suspension of your account"; duplicative posts across accounts → suspension risk; automated likes banned; automated replies without opt-in → removal from search / suspension of app or account — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)
- X authenticity policy prohibits coordinated engagement ("coordinating to exchange engagement in any X features, such as Likes, Polls, Replies, Reposts, Lists, Views, or Follows"), compensating others for metric inflation, follow-churn, indiscriminate following, duplicating another account's followers, "Copypasta" style repeated identical posts, edit-based engagement abuse, and bulk unsolicited replies/mentions/DMs; enforcement ladder includes anti-spam challenges (locks), reach restrictions, temporary feature loss, and permanent suspension for severe violations; in multi-account violations, users can be forced to keep one account and lose the rest — [X Authenticity policy (April 2025)](https://help.x.com/en/rules-and-policies/authenticity) (fetched via [Wayback capture, Oct 14, 2026](https://web.archive.org/web/20261014191834/https://help.x.com/en/rules-and-policies/authenticity))
- X ban evasion: "If an account has been suspended … X reserves the right to also suspend any other account we believe the same account holder … may be operating" — [X Authenticity policy](https://help.x.com/en/rules-and-policies/authenticity)
- LinkedIn: not allowed — bots or unauthorized automated methods "to create, comment on, like, share, or re-share posts, or otherwise drive inauthentic engagement"; spam; algorithmic manipulation — [LinkedIn User Agreement §8.2](https://www.linkedin.com/legal/user-agreement)
- LinkedIn spam policy: "We may remove or limit the distribution of content designed to artificially increase engagement through misuse or misrepresentation of LinkedIn's features." — [LinkedIn Spam policy](https://www.linkedin.com/help/linkedin/answer/137372)
- LinkedIn engagement pods: "Don't do things to artificially increase engagement with your content. Respond authentically to others' content and don't agree with others ahead of time to like or re-share each other's content." — [LinkedIn Professional Community Policies — Be professional / spam section](https://www.linkedin.com/legal/professional-community-policies)
- LinkedIn automated-activity enforcement: restrict account, require disabling the automating software; appeals process exists — [Automated activity on LinkedIn](https://www.linkedin.com/help/linkedin/answer/a1340567)

**Community-reported incidents (unverified, anecdotal, often vendor-published):**
- Reddit user: account temporarily restricted with an "automation tool" warning after sending ~200 connection requests in a week — which was their stated weekly limit and done manually — [r/linkedin thread](https://www.reddit.com/r/linkedin/comments/12qi9j3/linkedin_thinks_i_am_using_an_automation_tool_and/)
- Reddit user: brand-new account flagged for "automation tools" while manually browsing a college network — illustrative of false positives — [r/linkedin thread](https://www.reddit.com/r/linkedin/comments/1bxga16/my_account_gets_restricted_because_of_false/)
- IndieHackers post (Jan 2026): founder says his LinkedIn accounts were banned three times while using automation tools; claims LinkedIn's Q4 2024 algorithm update raised detection rates ~40% — vendor/self-promotional context (he sells a "safer" tool), treat number as unverified — [IndieHackers](https://www.indiehackers.com/post/my-linkedin-account-got-banned-3-times-heres-what-i-learned-about-safe-automation-d2447ed6c0)
- Vendor support docs (LinkedHelper): restrictions "can happen with any LinkedIn account even if no automation tool is used," e.g., when an account is managed from several locations/devices simultaneously — [LinkedHelper support](https://support.linkedhelper.com/hc/en-us/articles/360017222880-My-LinkedIn-account-got-restricted-though-I-followed-your-recommendations)
- Vendor blog (Phantombuster, Jul 2026) describes LinkedIn's enforcement ladder: soft warnings ("You're visiting too many profiles"), feature-level restrictions (connection requests/messages), then temporary restrictions or permanent bans — [Phantombuster blog](https://phantombuster.com/blog/social-selling/linkedin-automation-tool-warning/)
- Vendor blog (Cleverly, May 2026): "Learn why LinkedIn automation tools get accounts banned…" — the existence of this vendor genre itself documents the risk pattern — [Cleverly blog](https://www.cleverly.co/blog/why-linkedin-automation-tools-get-your-account-banned-and-what-to-do-instead)
- X (Twitter, Nov 2020): developer's airplane-tracking bot lost API write access with a generic "This App has violated Twitter Rules and policies" notice and repeated support emails; no specific rule cited; access not restored 10+ days later — illustrates opaque enforcement and slow appeals for developers — [Hacker News thread](https://news.ycombinator.com/item?id=25182239)

**Engagement-farming / duplicate-content/account actions reported in the press:**
- X owner Elon Musk (April 2024): "Accounts doing engagement farming will be suspended, traced to source" — platform-operator statement, not formal policy text — [Musk on X via HN](https://news.ycombinator.com/item?id=40084540) (original: https://twitter.com/elonmusk/status/1781183251731677264)
- TechCrunch (July 30, 2026): LinkedIn added a button to report AI-generated "slop" — signal that AI-generated flood content is now an explicit enforcement/reporting category — [TechCrunch](https://techcrunch.com/2026/07/30/linkedin-adds-a-button-to-report-ai-generated-slop/)
- The Register (July 9, 2026): "AI slop writing has taken over the internet, particularly LinkedIn and X" — reporting a finding that ~25% of long-form social posts appear AI-generated; secondary reporting, underlying study not independently verified here — [The Register](https://www.theregister.com/ai-and-ml/2026/07/09/ai-slop-writing-has-taken-over-the-internet-particularly-linkedin-and-x/5269525)
- Hacker News community sentiment (2025–2026): repeated threads and tools aimed at blocking "rage-bait"/engagement-farming and AI slop on LinkedIn/X (e.g., "[Show HN: FeedFirewall](https://news.ycombinator.com/item?id=46913452)" rage-bait detector, "[Cocoon](https://news.ycombinator.com/item?id=46786141)" X feed filter, "[Odin, Wikipedia and engagement farming](https://news.ycombinator.com/item?id=48781196)" with 262 points and 400+ comments) — evidence that audience backlash to engagement farming is growing, though these are community signals, not policy.

### Inferences
- The highest-probability ban triggers for an automation desk are, in order: (1) browser automation (Puppeteer/Selenium/extensions) against LinkedIn, (2) any automated liking/commenting/programmatic replies on X without opt-in, (3) duplicate or near-duplicate content including cross-posting the same text to multiple accounts, (4) high-volume unsolicited DMs/replies, (5) engagement pods, (6) "AI slop" flooding — not yet a per se ban but increasingly a demotion/reporting target.
- LinkedIn's enforcement has documented false positives and punishes even manual high-volume behaviors, so a desk should keep far inside human-normal cadences (single-digit posts/week) regardless of the 150/day API ceiling.
- X's opaque enforcement (2020 example) means prevention matters more than appeal; remediation paths are slow and generic.

### Gaps
- No first-party published statistics were found on how many accounts were restricted/banned specifically for automation in 2025–2026 on either platform in this research pass (LinkedIn transparency reports and X enforcement reports were not fetched).
- No specific documented case was found of an account banned solely for API-based, human-approved scheduled posting of its own original content — the absence is notable but not proof it's safe.
- Reddit/vendor reports could not be independently verified; vendor blogs have commercial incentives to describe (and sell against) ban risk.

---

## Key Question 5: How do existing tools stay compliant (human approval steps, rate limiting, native API use vs browser automation like Puppeteer)?

### Takeaway
The compliant pattern, per the platforms' own documents, is: official APIs only (no browser scripting), explicit per-user consent, showing the user exactly what will be published before it goes out, honoring opt-outs, staying within documented rate limits, and keeping volumes human-scale. Browser automation (Puppeteer/headful scripting/extensions) is the single most clearly prohibited technique on both platforms and is explicitly tied to restriction/permanent-suspension risk. The human-approval step in an automation desk is not just UX — it is the mechanism that satisfies X's "show exactly what will be published" consent requirement.

### Cited Findings
- X requires services that post on a user's behalf to "show exactly what will be published" before publishing and to obtain permission (and explain cross-posting); authentication alone is not consent — [X Developer Policy](https://developer.x.com/en/developer-terms/policy)
- X automation rules require express consent for automated actions on another user's account, clear description of the actions, honoring opt-outs, and re-consent if purpose/functionality changes — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)
- X explicitly prohibits "non-API-based forms of automation, such as scripting the X website," punishable by permanent suspension — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)
- LinkedIn prohibits third-party software/browser extensions that automate activity and warns accounts get restricted; recommends disabling the tool as remediation — [Automated activity on LinkedIn](https://www.linkedin.com/help/linkedin/answer/a1340567); [Prohibited software and extensions](https://www.linkedin.com/help/linkedin/answer/56347)
- LinkedIn's API ecosystem provides the compliant channel: Share on LinkedIn (member posts with `w_member_social`) plus documented rate limits (150/member/day; 100k/app/day); members must consent, and apps may not scrape, store content beyond tokens/consented data — [Share on LinkedIn docs](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin); [LinkedIn API Terms](https://www.linkedin.com/legal/l/api-terms-of-use)
- X's pay-per-use model itself enforces a soft budget cap (spending limits, credit balance blocking, auto-recharge safeguards), complementing rate limits and the Developer Agreement's no-circumvention rule — [X API pricing](https://docs.x.com/x-api/getting-started/pricing); [X Developer Agreement §III.D](https://developer.x.com/en/developer-terms/agreement)
- Community example of compliance-by-design in the current market: "Tact," a LinkedIn client that is explicitly "keyboard-first," "doesn't ghostwrite messages or auto-send anything" and only coaches the human, positions itself opposite "AI-generated slop" — [Show HN (Jan 2026)](https://news.ycombinator.com/item?id=46636922)
- Community discussion (Dec 2025) of the exact desk problem — collecting LinkedIn posts to comment on later, with "no bots auto-commenting, no mass spam," "human-in-the-loop," explicitly asking for the "most robust, boring, semi-automated setup" — received no answers, illustrating there is no sanctioned API path for LinkedIn search-and-engage automation — [Ask HN](https://news.ycombinator.com/item?id=46146228)

### Inferences
- A compliant automation desk should implement, at minimum: (1) API-only posting (X OAuth user-context; LinkedIn Share API with member OAuth); (2) mandatory human approval of content immediately before publishing (satisfies X's "show exactly what will be published"); (3) rate limiting well below platform limits; (4) no automated replies/likes/follows/DMs at all in v1; (5) logging and an easy opt-out/kill switch; (6) no cross-posting of identical text to multiple accounts.
- Tools that market "safe LinkedIn automation" via browser extensions are selling a technique that LinkedIn's own help pages prohibit; their "safe volumes/presets" reduce detection odds but do not change the compliance status.
- Human approval plus API posting is defensible for both platforms; anything "engagement" beyond publishing is where compliance collapses.

### Gaps
- No first-party compliance documentation from mainstream schedulers (Buffer/Hootsuite/Typefully/Later) was fetched to cite their exact posture; their API-based operation is inferred from the existence of the official Share/post APIs and general industry practice.
- No fetched source quantifies detection rates for browser automation vs API use; enforcement claims from vendors are unverifiable.

---

## Key Question 6: For "engagement farming" — where is the accepted line? (questions, polls, strong opinions vs fake stories, pods)

### Takeaway
The official line: producing content designed to attract organic engagement (questions, polls, strong opinions, interesting takes) is fine, but manufactured engagement is not. Both platforms explicitly ban pods/coordinated engagement exchange and compensation-for-engagement, and LinkedIn bans "content designed to artificially increase engagement" plus false/misleading content; X bans copypasta, trending-hashtag manipulation, and deceptive engagement tricks. Fake personal stories cross into prohibited "false or misleading" content and, if AI-generated at volume, increasingly trigger AI-slop demotion/reporting mechanisms.

### Cited Findings
- LinkedIn explicitly: "don't agree with others ahead of time to like or re-share each other's content" (pods) and "make the effort to create original, professional, relevant, and interesting content in order to gain engagement" — [LinkedIn Professional Community Policies](https://www.linkedin.com/legal/professional-community-policies)
- LinkedIn prohibits content that is "false, misleading, or intended to deceive" and undisclosed endorsements in exchange for benefit — fake stories fall under this — [LinkedIn Professional Community Policies — Be Trustworthy](https://www.linkedin.com/legal/professional-community-policies)
- LinkedIn spam policy: may remove/limit "content designed to artificially increase engagement through misuse or misrepresentation of LinkedIn's features" — [LinkedIn Spam policy](https://www.linkedin.com/help/linkedin/answer/137372)
- X explicitly prohibits "coordinating to exchange engagement in any X features, such as Likes, Polls, Replies, Reposts, Lists, Views, or Follows" and "coordinating with and/or compensating others to conduct account metric inflation" in any feature (note: *Polls* is named as an engagement feature that may not be exchanged) — [X Authenticity policy](https://help.x.com/en/rules-and-policies/authenticity)
- X prohibits copypasta ("repeatedly posting identical or nearly identical posts"), trending-hashtag manipulation, posts with excessive unrelated hashtags, and "deceptively editing … using a post's existing engagement to amplify substantially different content" — [X Authenticity policy](https://help.x.com/en/rules-and-policies/authenticity)
- X's Developer Policy bans "pay to engage" — compensation for Posts, follows, likes, reposts, comments, replies — [X Developer Policy](https://developer.x.com/en/developer-terms/policy)
- X allows "authentically coordinating with others to express ideas, viewpoints, support, or opposition towards a cause in a non-violative manner" (i.e., real advocacy/coordination is fine; engagement exchange is not) — [X Authenticity policy](https://help.x.com/en/rules-and-policies/authenticity)
- High-level operator stance: X owner publicly promised suspension for engagement-farming accounts (April 2024) — [Musk post via HN](https://news.ycombinator.com/item?id=40084540)
- LinkedIn added a user-facing "report AI-generated slop" button (July 2026) — [TechCrunch](https://techcrunch.com/2026/07/30/linkedin-adds-a-button-to-report-ai-generated-slop/)
- Prevalence: ~25% of long-form posts on LinkedIn/X appear AI-generated per The Register's July 2026 report — [The Register](https://www.theregister.com/ai-and-ml/2026/07/09/ai-slop-writing-has-taken-over-the-internet-particularly-linkedin-and-x/5269525)
- Cultural backlash data points: viral 2026 HN essay "Odin, Wikipedia and engagement farming" (262 points, 400+ comments) and multiple community-built blockers for rage-bait/engagement farming — [HN](https://news.ycombinator.com/item?id=48781196); [FeedFirewall](https://news.ycombinator.com/item?id=46913452); [Cocoon](https://news.ycombinator.com/item?id=46786141)

### Inferences
- Accepted line: genuine hooks that earn engagement (real questions, polls about your genuine topic, contrarian-but-sincere opinions, useful threads) = allowed. Manufactured engagement (pods, reciprocal like groups, bought engagement, "comment X to get Y" style bait if it games features, multiple identical posts) = explicitly prohibited or demoted.
- Fake stories are the clearest red zone: they violate LinkedIn's false/misleading-content rule and X's deception/authenticity rules; they also carry reputational risk as audiences increasingly recognize and punish "LinkedIn broetry"/AI slop (report button, blockers, backlash).
- Because X names "Polls" in the prohibited exchange list, running polls is fine, but arranging pod members to vote together is not. The distinction is coordination/compensation, not the format.
- For the desk: AI-assisted drafting is fine, but content should be original, specific, and non-templated; repeated formulaic output risks both "gratuitously repetitive" spam findings on LinkedIn and AI-slop demotion.

### Gaps
- Neither platform publishes a formal definition of "engagement farming"; the accepted line is inferred from enforcement policies, not an explicit rule set.
- No published enforcement statistics for engagement-pod removals; risk is mostly policy-based, not empirically quantified.
- Whether LinkedIn's "report AI-generated slop" button leads to demotion, removal, or nothing is not documented publicly (feature reported by TechCrunch only).

---

## Key Question 7 (Synthesis): What may and may not an automation desk safely do — design guardrails and cost envelope

### Takeaway
A self-hosted desk that drafts AI/tech posts, requires human approval, and publishes via official APIs to the user's own X and LinkedIn accounts sits within the documented rules at hobbyist scale: on X it must never like, mass-follow, DM without opt-in, auto-reply on keywords, cross-post duplicates, or automate trending topics; on LinkedIn it must never use browser automation, must publish only the member's own content with consent, and should treat the API Terms' "automate posting" clause as an unresolved legal risk. Analytics via API is cheap and easy on X (Owned Reads) but effectively gated on LinkedIn (partner-reviewed Community Management API).

### Cited Findings (basis for each guardrail)
- Publish via API with explicit user consent and content preview — required by [X Developer Policy](https://developer.x.com/en/developer-terms/policy) and satisfied by Share/Posts API consent flows on [LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin)
- Never use browser automation (Puppeteer/Selenium/extensions) — X: permanent suspension risk for "scripting the X website" ([Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)); LinkedIn: account restriction for software that automates activity ([help](https://www.linkedin.com/help/linkedin/answer/a1340567))
- No automated likes (X outright ban), no bulk follow/unfollow, no keyword-triggered replies, no unconsented DMs, no unapproved AI reply bots — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)
- No duplicate/cross-posted identical content across accounts; no trending-topic automation — [X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation)
- No pods/engagement exchange — [X Authenticity](https://help.x.com/en/rules-and-policies/authenticity); [LinkedIn PCP](https://www.linkedin.com/legal/professional-community-policies)
- Keep volumes human-scale; respect 150/day/member LinkedIn share limit and X rate limits/spend caps — [Share on LinkedIn docs](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin); [X pricing](https://docs.x.com/x-api/getting-started/pricing)
- Costs (Oct 2026): X $0.015/text post, $0.20/post with URL, $0.005/media upload, $0.001/resource Owned Reads, Counts $0.005–$0.01; LinkedIn API free (reserves right to charge) — [X pricing](https://docs.x.com/x-api/getting-started/pricing); [LinkedIn API Terms §8.2](https://www.linkedin.com/legal/l/api-terms-of-use)
- LinkedIn analytics (`r_member_postAnalytics`, `r_member_profileAnalytics`) only via Community Management API with application review — [Increasing Access](https://learn.microsoft.com/en-us/linkedin/marketing/getting-access)
- Auth requirements: X user-context OAuth (1.0a or 2.0 PKCE) with `tweet.write`/`media.write`; LinkedIn member OAuth with `w_member_social` — [X auth](https://docs.x.com/fundamentals/authentication/overview); [X media upload](https://docs.x.com/x-api/media/upload-media); [Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin)

### Inferences
- Recommended desk architecture (inference, grounded in the rules above): queue of AI-drafted posts → mandatory human edit/approve step → publish via official API within rate limits → store only tokens and the user's own content → no automated reactions of any kind → kill switch honored immediately → prefer owned-read endpoints for self-metrics. Distinct use cases should not be split across many X apps (max 3 dev/staging/prod apps, same use case) — [X Developer Policy](https://developer.x.com/en/developer-terms/policy).
- If the user wants engagement features later, the only safely automatable interactions per the rules are: auto-replies to users who explicitly opt in (one per interaction, with opt-out) and automated DMs only to users who initiated/opted in — both need product-level consent design, and AI reply bots need X's prior written approval.
- Budget envelope (inference): typical solo-desk usage (≤20 posts/month, occasional media, self-metrics) ≈ $0.30–$1/month on X; LinkedIn $0. Monthly cost only becomes material if posting links at volume ($0.20/post) — that is a pricing signal that link-heavy, mass-posting desks are economically discouraged by X's own 2026 pricing.

### Gaps
- The LinkedIn API Terms §3.1(26) ("automate posting") interpretation remains the single largest unresolved legal question for the desk; the rest of the design can be verified against explicit text, but this clause needs counsel.
- No compliance/review artifacts were found showing what, if anything, LinkedIn does to distinguish "member-authorized scheduled publishing" from "automation" at the API level (the Share API itself is the likely answer, but it is not stated).
- No X statement found on whether a *single* account posting frequently (but not massively) via API triggers spam review; enforcement thresholds are opaque.
- The desk's "read metrics" story on LinkedIn remains unresolved at hobbyist tier (manual UI reading or partner application).
