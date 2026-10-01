# Image Generation and Media Attachment for X & LinkedIn Posts: APIs, Card Rendering, and Upload Mechanics (verified as of October 2026)

Research scope: how an automated publishing system (LLM already on Fireworks AI) can generate or compose images and attach them to X (Twitter) and LinkedIn posts — covering image-generation APIs, programmatic text/stat-card and chart rendering, OG:image harvesting, and each platform's media-upload endpoints, auth, limits, and pricing.

---

## 1. Can Fireworks AI generate images, and which alternative image-generation APIs should we use?

### Takeaway
No — Fireworks AI deprecated image generation on 2026-06-10, so images must come from a different provider. The strongest documented options are OpenAI's `gpt-image-2.5` models (token-priced), Black Forest Labs' FLUX APIs (per-megapixel credits, $0.008–$0.08/image), Together AI and Replicate (per-image billing starting around $0.0017–$0.003), making FLUX-class quality available from multiple vendors at $0.015–$0.05 per image, or near-free at SDXL/schnell quality.

### Cited Findings
- Fireworks changelog entry dated **2026-06-10**, titled "Audio inference and image generation deprecation": "Audio inference and image generation are deprecated." — [Fireworks changelog](https://docs.fireworks.ai/updates/changelog)
- The Fireworks documentation index (llms.txt, full page listing) contains no image-generation guide or text-to-image endpoint reference — [Fireworks docs index](https://docs.fireworks.ai/llms.txt)
- OpenAI's image API (current models include `gpt-image-2.5-sunburst` and `gpt-image-2.5-flare`, with `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini`, `chatgpt-image-latest` also listed) is documented as letting you "generate and edit images from text prompts using `gpt-image-2.5-sunburst` and `gpt-image-2.5-flare`", via `POST /v1/images/generations` (plus edits endpoints and a Responses API tool); it supports streaming 0–3 partial images — [OpenAI image generation guide](https://platform.openai.com/docs/guides/image-generation)
- OpenAI image API access requires organization verification ("API Organization Verification") — [OpenAI image generation guide](https://platform.openai.com/docs/guides/image-generation)
- OpenAI image pricing is token-based, not per image: `gpt-image-2.5` charges $8 per 1M image input tokens and $30 per 1M image output tokens; `gpt-image-1-mini` charges $2.50/$8 per 1M image tokens — [OpenAI pricing](https://platform.openai.com/docs/pricing)
- Black Forest Labs (BFL) hosted API pricing, 1 credit = $0.01 — [BFL pricing](https://bfl.ai/pricing):
  - FLUX.2 [pro]: $0.03 first megapixel + $0.015 per additional MP ($0.03/image at 1 MP)
  - FLUX.2 [max]: $0.07 first MP + $0.03 per additional MP
  - FLUX.2 [flex]: $0.05 per MP
  - FLUX.2 [klein] 4B: $0.014 first MP; FLUX.2 [klein] 9B: $0.015 first MP
  - FLUX.1 Kontext [pro]: $0.04; FLUX.1 Kontext [max]: $0.08
  - FLUX 1.1 [pro]: $0.04; FLUX 1.1 [pro] Ultra: $0.06
  - FLUX.1 [dev] (open-weights, non-commercial license): $0.025
  - FLUX 3 Klein: $0.008–$0.036 per image
- Together AI serverless per-image prices — [Together AI pricing](https://www.together.ai/pricing): FLUX.2 [pro] $0.03; FLUX.2 [dev] $0.0154; FLUX.2 [flex] $0.03; FLUX.2 [max] $0.070/MP; FLUX.1 Kontext [pro] $0.04 / [max] $0.08; FLUX1.1 [pro] $0.04; GPT Image 2 $0.053; GPT Image 1.5 $0.034; SDXL $0.0019/MP; Qwen Image $0.0058; Juggernaut Lightning Flux $0.0017/MP; Ideogram 4.0 $0.06; Imagen 4.0 Fast $0.02 / Ultra $0.06; Nano Banana Pro $0.134; Gemini 3.1 Flash Image $0.05. The page's structured data gives the full image-model range as $0.0006–$0.134 per image.
- Replicate bills "per output or per GPU-second depending on model"; examples: `black-forest-labs/flux-1.1-pro` $0.04 per output image; `flux-dev` $0.025; `flux-schnell` $3.00 per 1,000 images ($0.003 each); `ideogram-ai/ideogram-v3-quality` $0.09; `recraft-ai/recraft-v3` $0.04. Custom models deployable via its open-source Cog tool — [Replicate pricing](https://replicate.com/pricing)

### Inferences
- Because Fireworks removed image generation, the system needs a second image provider while keeping Fireworks for LLMs; OpenAI (`gpt-image-2.5`) or BFL (`bfl.ai`) are the most straightforward first choices, since their APIs are purpose-built for text-to-image with published prices.
- Together AI and Replicate both serve the same BFL FLUX models at the same or similar per-image prices (e.g., FLUX.2 [pro] at $0.03, FLUX 1.1 [pro] at $0.04 on both Together and Replicate), so vendor choice can be driven by existing billing relationships rather than price.
- For a news-posting bot, cheap tiers (FLUX schnell at ~$0.003/image via Replicate, SDXL at $0.0019/MP via Together, FLUX.2 [klein] at ~$0.014 via BFL) are sufficient for decorative or illustrative images; premium models ($0.05–$0.13) make sense only for hero images.
- Token-based OpenAI pricing means the per-image cost must be computed from resolution/quality and cannot be compared directly to FLUX's per-megapixel quotes without benchmarking.

### Gaps
- The Fireworks changelog entry states the deprecation but provides **no migration path** or substitute recommendation for image generation.
- Stability AI pricing could not be retrieved (the pricing page renders client-side and returned no data across two attempts) — no verified Stability per-image prices in these notes.
- No flat USD-per-image figure is published for OpenAI models; only token rates (per-image cost depends on size/quality settings).
- Replicate's pricing page does not enumerate its full current model catalog; only the featured models listed here were verified.

---

## 2. How to render text cards, quote cards, stat cards, and charts programmatically

### Takeaway
The de-facto open-source pipeline for branded cards is JSX/HTML → SVG → PNG: Vercel's `satori` (JSX→SVG, ~14.1k stars, MPL-2.0) with `sharp` (librsvg) or `resvg-js` for the PNG step. For chart images, QuickChart provides a hosted Chart.js-based image API (also AGPLv3 self-hostable), so charts can be rendered without a browser.

### Cited Findings
- `satori` converts JSX to SVG; it is not a browser renderer — fonts must be supplied explicitly to it — and recommends rendering the SVG to PNG with Sharp, "which draws SVG with librsvg": `const png = await sharp(Buffer.from(svg)).png().toBuffer()` — [vercel/satori](https://github.com/vercel/satori)
- `satori` requires a `layout.wasm` build-time setup, does not support React hooks, and is licensed MPL-2.0; the repo shows ~14.1k stars as of the fetch — [vercel/satori](https://github.com/vercel/satori)
- Sharp is the Node.js image-processing library used for the SVG→PNG step — [sharp](https://sharp.pixelplumbing.com), [vercel/satori](https://github.com/vercel/satori)
- `resvg-js` is "a high-performance SVG renderer and toolkit, powered by Rust based resvg, with Node.js backend using napi-rs, also a pure WebAssembly backend" — an alternative Rust/WASM SVG→PNG renderer for Node — [thx/resvg-js](https://github.com/thx/resvg-js)
- QuickChart generates chart images from a URL/API on top of Chart.js (the site claims 4B+ images rendered); it is dual-licensed AGPLv3 / commercial and ships official JavaScript and Python SDKs — [QuickChart](https://quickchart.io/)

### Inferences
- For PostFlow, the lightest robust stack is `satori` + `sharp` (pure Node, no headless browser needed): define a card template as JSX, render stat/quote cards at 1200×630 (or 1080×1350 for LinkedIn portrait formats), pass fonts and the layout.wasm, then emit PNG for upload.
- QuickChart lets the system render line/bar/stat charts server-side without shipping a browser runtime; using the hosted API avoids the AGPLv3 self-host question, but a self-hosted instance requires complying with AGPLv3 unless a commercial license is bought.
- Because AI-looking content measurably underperforms on authenticity perception (see section 6), stat cards, quote cards, and clean charts are likely higher-trust visual formats for an AI-news account than AI-generated art.

### Gaps
- No source fetched for headless-browser HTML-to-image approaches (Playwright/Puppeteer screenshots), `node-canvas`, or `@vercel/og`; only satori + sharp + resvg-js + QuickChart were verified in this research.
- No benchmark data found comparing render quality, font handling, or speed across the rendering approaches; the choice above is based on library documentation, not measured tests.

---

## 3. OG:image harvesting: fetching, resizing, and attribution practice

### Takeaway
Article `og:image` metadata is standardized (it is one of the four required Open Graph properties, with optional width/height/alt structured fields), and mature Node libraries (`open-graph-scraper`, `metascraper`) parse it, including fallbacks; images must then be normalized to platform caps (X: ≤5 MB JPG/PNG/GIF/WEBP; LinkedIn: <36.2M pixels) before upload. No authoritative rule exists for re-publishing third-party OG images, so attribution/rights are a policy gap, not a solved problem.

### Cited Findings
- The Open Graph protocol requires `og:image` (an image URL representing the page) as one of four required properties, and defines structured sub-properties `og:image:url`, `og:image:secure_url`, `og:image:type`, `og:image:width`, `og:image:height`, `og:image:alt`; "If the page specifies an og:image it should specify `og:image:alt`"; multiple `og:image` tags are allowed and the first is given preference — [ogp.me](https://ogp.me/)
- `open-graph-scraper` (npm package, latest 6.12.0 as listed) is a "Node.js scraper module for Open Graph and Twitter Card info"; it doesn't support browser usage, but a `open-graph-scraper-lite` variant exists for parsing provided HTML — [jshemas/openGraphScraper](https://github.com/jshemas/openGraphScraper), [npm](https://www.npmjs.com/package/open-graph-scraper)
- `metascraper` (npm, latest 5.51.1 as listed) scrapes metadata "using Open Graph metadata, regular HTML metadata, and a series of fallbacks"; it parses HTML you supply and never fetches the page itself — [microlinkhq/metascraper](https://github.com/microlinkhq/metascraper), [npm](https://www.npmjs.com/package/metascraper)
- Platform-side size/format constraints that apply after extraction: X images ≤5 MB, JPG/PNG/GIF/WEBP ([X media docs](https://docs.x.com/x-api/media/introduction)); LinkedIn images must be under 36,152,320 pixels ([LinkedIn Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api))

### Inferences
- Practical pipeline: fetch article HTML → parse `og:image` (prefer `og:image:secure_url`; fall back to `twitter:image` via the scraper libraries) → download → resize/re-encode with `sharp` to fit each platform's caps and format list → upload as native media (X: media upload + `media_ids`; LinkedIn: Images API) rather than relying on the platform's link-preview card, which can't be controlled.
- Rights/attribution are not standardized by ogp.me or by the scraper libraries; the safe operating pattern for a republishing bot is to prefer self-generated cards, and when using a publisher's OG image, keep the link and credit the source in the post text. (This is an inference from the absence of any license/attribution mechanism in the OG spec — see Gaps.)
- LinkedIn's <36.2M-pixel cap is unlikely to be hit by article OG images (typically ~1200×630), so format conversion to JPG/PNG under 5 MB for X is the more common normalization step.

### Gaps
- No authoritative source found defining attribution requirements for programmatically re-uploading third-party og:images; copyright/permission varies by publisher and is not addressed by the Open Graph spec.
- Whether `og:image:alt` from the source page should be reused as uploaded alt text (vs. generating fresh alt text) is not covered by any fetched guidance.

---

## 4. X (Twitter) API: image upload mechanics, auth, alt text, limits, and pricing

### Takeaway
X API v2 supports both a simple image upload (`POST /2/media/upload`) and a chunked initialize→append→finalize→STATUS flow; attach up to 4 photos per post via `POST /2/tweets` with `media.media_ids`; set alt text via `POST /2/media/metadata` (max 1,000 chars); OAuth 2.0 user-context tokens with the `media.write` scope are sufficient (OAuth 1.0a is no longer required); billing is pay-per-usage — posting costs $0.015/request ($0.20 when the post includes a URL), and media metadata costs $0.005/request.

### Cited Findings
- Images: ≤5 MB, JPG/PNG/GIF/WEBP; up to 4 photos per post; animated GIFs up to 15 MB (some limits vary by account tier) — [X media introduction](https://docs.x.com/x-api/media/introduction)
- Simple upload: `POST /2/media/upload` (used for images; returns a media ID) — [Upload Media](https://docs.x.com/x-api/media/upload-media)
- Chunked upload flow: `POST /2/media/upload/initialize` (JSON body with `media_type`, `total_bytes`, `media_category`, e.g. `tweet_image`) → `POST /2/media/upload/{id}/append` (with `segment_index` and a chunk of ≤5 MB) → `POST /2/media/upload/{id}/finalize` → `GET /2/media/upload?command=STATUS&media_id=…` — [Initialize Media Upload](https://docs.x.com/x-api/media/initialize-media-upload), [Append Media Upload](https://docs.x.com/x-api/media/append-media-upload), [Finalize Media Upload](https://docs.x.com/x-api/media/finalize-media-upload), [Get Media Upload Status](https://docs.x.com/x-api/media/get-media-upload-status), [Chunked upload quickstart](https://docs.x.com/x-api/media/quickstart/media-upload-chunked)
- Attach media to a post: `POST /2/tweets` with a `media` object containing `media_ids` — [Create Post](https://docs.x.com/x-api/posts/create-post)
- Alt text: `POST /2/media/metadata` with body like `{"id": <media_id>, "metadata": {"alt_text": {"text": "…"}}}`, capped at 1,000 characters — [Create Media Metadata](https://docs.x.com/x-api/media/create-media-metadata)
- The media endpoints' security definitions accept OAuth 2.0 user-context tokens with the `media.write` scope, as well as OAuth 1.0a user tokens — [Upload Media](https://docs.x.com/x-api/media/upload-media), [Create Media Metadata](https://docs.x.com/x-api/media/create-media-metadata)
- Pricing is pay-per-usage (usage-based credits): Post Create $0.015 per request — $0.20 per request when the post includes a URL; Media Metadata $0.005 per request; a "Content: Manage" line item at $0.005 per request — [X API pricing](https://docs.x.com/x-api/getting-started/pricing), [Usage and Billing](https://docs.x.com/x-api/fundamentals/post-cap)

### Inferences
- The full cost of one image post ≈ $0.015 (post) + $0.005 (alt text metadata) + $0.005 (upload, if "Content: Manage" covers media-upload calls; docs don't map that line item to a specific endpoint) ≈ $0.02 — but including an external URL in the post text raises the post request itself to $0.20, a 10x+ jump that should drive posting design (e.g., keeping links out of X posts or accepting the cost).
- For new integrations, OAuth 2.0 user context + `media.write` avoids OAuth 1.0a signature complexity; both remain supported.
- The simple `POST /2/media/upload` is sufficient for generated PNG cards (well under 5 MB), so the chunked flow is only needed for videos/GIFs.

### Gaps
- The docs fetched do not explicitly state which billing line item covers `POST /2/media/upload` ("Content: Manage" is the closest match but unproven).
- Media upload rate limits (e.g., per-24h caps) were not captured in this research.
- Exact GIF frame/dimension limits and how they differ by Premium tier are referenced by the docs but were not itemized.

---

## 5. LinkedIn: attaching images to personal-profile posts — flow and limits

### Takeaway
For a personal profile, the current flow is the REST Images API: `POST https://api.linkedin.com/rest/images?action=initializeUpload` with the member owner URN (`urn:li:person:{id}`) → PUT the binary to the returned `uploadUrl` → create the post with `POST https://api.linkedin.com/rest/posts` referencing the returned image URN in `content.media.id` plus `altText`; `w_member_social` scope and a `Linkedin-Version` header are required; images must be under 36,152,320 pixels in JPG/GIF/PNG.

### Cited Findings
- Image upload flow: initialize via `POST /rest/images?action=initializeUpload` with an `owner` URN, which returns an upload URL and image URN; then upload the binary to that URL; then reference the image URN when creating the post — [LinkedIn Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api)
- Posts are created via `POST https://api.linkedin.com/rest/posts` with the image URN and `altText` inside the `content.media` object — [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
- Requests must include the `Linkedin-Version: YYYYMM` header and `X-Restli-Protocol-Version: 2.0.0` — [LinkedIn Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api)
- Member (personal-profile) posting requires the `w_member_social` permission and an `urn:li:person:{id}` owner; for images with member URN owners, "the caller must match the image owner" — [LinkedIn Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api)
- Image constraints: under 36,152,320 pixels; JPG/GIF/PNG; GIFs limited to 250 frames; alt text accepted up to 4,086 characters (docs recommend keeping alt text concise, ~120 characters) — [LinkedIn Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api)
- The Images API is the current-generation API; the legacy Assets API performed the same upload role and is superseded for this flow — [LinkedIn Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api), [Assets API (legacy)](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/vector-asset-api)
- Versioning: version `202511` sunsets on 2026-11-16; integrations should move to the latest versioned APIs (current view monikers run through `li-lms-2026-10`) — [LinkedIn versioning](https://learn.microsoft.com/en-us/linkedin/marketing/versioning); the Images API page itself is currently served at view `li-lms-2026-09` (page updated 2026-06-24) — [LinkedIn Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api)
- A MultiImage API exists for posts with multiple images, reusing the same Image URN upload flow (multiple uploads, then one post referencing several image URNs) — [LinkedIn MultiImage API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api)

### Inferences
- For PostFlow's personal-profile use case, no company-page permissions are needed — `w_member_social` + `urn:li:person:{id}` + a current `Linkedin-Version` header is the complete requirement set for image posts.
- Because LinkedIn sunsets versions roughly 12 months after release (202511 → 2026-11-16), the version string should be treated as configuration kept fresh on a schedule, not a hardcoded constant.
- Setting `altText` at upload/post time is effectively free (no extra call, unlike X's separate metadata request) — the LinkedIn flow can include alt text in the same `initializeUpload`/post payloads.

### Gaps
- LinkedIn API pricing/cost per call for member posting was not covered in the fetched docs (no pricing data found to verify whether any per-call cost exists).
- Rate limits for image uploads or post creation were not captured.
- Whether `altText` should be supplied at initializeUpload time vs. post-creation time (and precedence) was not fully pinned down from the fetched pages.

---

## 6. Engagement evidence: which image styles perform on X and LinkedIn (and AI-content trust signals)

### Takeaway
Large-sample benchmark data shows images help LinkedIn far more than X (LinkedIn image posts ~14.4% ER vs X images ~1.6% ER; LinkedIn documents/carousels peak at ~37%), and a 2026 Nature Scientific Reports controlled experiment shows AI-assisted content boosts volume/engagement but reduces perceived quality/authenticity ("robotic", "generic", more Dislikes, negative spillover), with transparent disclosure recommended — favoring clean, informative visuals over AI-art style images.

### Cited Findings
- ZoomSphere's 2025 report analyzing 5,000,000+ posts ("The State of Social Media Engagement in 2025"): LinkedIn image posts ~14.4% engagement rate; LinkedIn documents/carousels ~37%; LinkedIn video ~11.6%; text ~5.1%; polls ~4.1%; Instagram static images 6.2% vs Reels 3.5%; X (Twitter) image posts ~1.6% engagement rate — [ZoomSphere report](https://www.zoomsphere.com/data-reports/the-state-of-social-media-engagement-rate-in-2025)
- Nature Scientific Reports (2026) controlled experiment, 680 U.S. participants in groups of five across five conditions on a simulated social platform: "AI-tools increase user engagement and volume of generated content, but at the same time decrease the perceived quality and authenticity of discussion, and introduce a negative spill-over effect on conversations" — [Nature Sci Reports](https://www.nature.com/articles/s41598-026-40110-8)
- In the same study, "All AI treatments significantly increase 'Dislikes', consistent with the lower quality and informativeness ratings observed", and participants described AI-assisted content as "robotic" and "generic"; the paper recommends "ensuring transparent disclosure of AI-generated content" — [Nature Sci Reports](https://www.nature.com/articles/s41598-026-40110-8)

### Inferences
- Effort on visual assets yields bigger relative gains on LinkedIn (images ≈ 3x text-post ER) than on X (images ≈ 1.6% vs text norms), so a shared image pipeline should prioritize LinkedIn formats (e.g., 1200×1200/1080×1350 squares and document/carousel-style sets) while X images are best treated as supporting elements.
- The trust findings favor stat cards, charts, and annotated screenshots over AI-generated artwork for a news account; if AI images are used, disclosure and a distinctive branded style reduce the "looks AI-generated" penalty risk.
- The engagement numbers are from a 2025 dataset — the most recent found — so treat magnitudes as directional, not exact for late 2026.

### Gaps
- No 2026-edition engagement benchmark data was found; the ZoomSphere dataset used here is the 2025 report.
- Two additional sources on AI-generated imagery trust (a ScienceDirect "illusion of reality" study and a 2026 Frontiers trust study) were identified but not fetched, so no findings from them are cited here.
- No study was found isolating performance of programmatically generated *cards/charts* specifically (vs. photos or AI art) on X/LinkedIn.

---

## 7. Reference implementations: open-source posting tools that already solve this

### Takeaway
Postiz is a mature AGPL-3.0 open-source social scheduler (37k+ stars) supporting X and LinkedIn, and serves as a working reference for these upload flows; self-hosting it requires registering your own platform developer apps.

### Cited Findings
- Postiz (github.com/gitroomhq/postiz-app) is an open-source (AGPL-3.0) social media scheduling tool showing ~37.2k GitHub stars as of the fetch; it supports scheduling to X and LinkedIn (among other networks) — [gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app)
- Postiz documentation lives at docs.postiz.com; self-hosted deployments require configuring your own developer apps/API credentials for each platform — [Postiz docs](https://docs.postiz.com/)

### Inferences
- Postiz's codebase is a practical reference for the exact X chunked-upload and LinkedIn Images API call sequences (including version headers), though its AGPL-3.0 license constrains direct code reuse in proprietary products.
- Because Postiz requires per-platform developer apps when self-hosted, PostFlow still needs its own X and LinkedIn developer credentials regardless.

### Gaps
- Mixpost (another self-hostable scheduler) was identified during research but not fetched/verified; no claims about it are made here.
- No other reference implementations were verified in this research.

---

*Note on method: all findings above were fetched from the linked primary sources between Oct 15, 2026 during this research pass. The `websearch` tool was unavailable; searches were performed via the DuckDuckGo HTML endpoint and direct page fetches. Negative findings (e.g., Fireworks deprecation wording, OpenAI org verification) reflect the state of those pages at fetch time.*
