# PostFlow design

## Brief

- Their words: "It is so cluttered… the design is so tech savvy. Normal people would find it difficult to understand what's happening… The UI UX should be simple impressive… Make it more mobile friendly… the template looks the same… The UX needs to be different."
- Product: PostFlow reads the news in a person's field, drafts short LinkedIn posts that name their source, checks them, and posts only what the person approves. Free beta on LinkedIn; X is part of a coming Pro plan.
- For: non-technical professionals (doctors, accountants, lawyers, teachers, marketers) and engineers. Most open it on a phone.
- The one thing: the next post that needs an answer, shown big, with Approve.
- Ambition: calm, obvious, a tool you can use in ten seconds a day. Mode: Kit (product), not Show.
- Stack: Next.js 16, React 19, Tailwind v4. Kept.
- Hard limits: keep every feature and fact; nothing posts without approval.
- Done means: a first-time visitor on a phone knows what to tap on every screen.

## Picks

- Theme: Fog City, cool gray, white, one cobalt: civic and calm. https://www.designlounge.live/themes/fog-city (dark: Fog Night)
- Pairing: Friendly SaaS (Plus Jakarta Sans, JetBrains Mono). https://www.designlounge.live/type/friendly-saas
- Family: Soft, 14px cards, pill buttons and chips.
- Recipe: web-app, direction Cobalt app (the app); the public page uses the same kit.
- Pieces: Agent approval card https://www.designlounge.live/demo/agent-approval-card (the home focus card), Sticky mobile CTA bar https://www.designlounge.live/demo/cta-sticky-mobile-bar (phone tab bar spacing), Split hero with UI card stack https://www.designlounge.live/demo/hero-split-ui-stack (landing hero).

## Defaults set aside

- Cobalt app locks the Quiet family (6px). Soft (14px, pills) is used instead, because the owner asked for friendly and mobile-first for non-technical people.
- Soft asks for a tonal primary button. The primary stays a solid cobalt fill so the one action (Approve) is unmistakable for first-time users.
- Labels that used the mono face now use the text face; mono is kept for nothing on screen, because mono read as "technical" to testers.

## Signature

The approval card: every post that needs you is a LinkedIn-looking preview with one cobalt Approve button. The same card appears on the landing page, so the site shows the exact thing you will do.

Designed using Design Lounge (https://www.designlounge.live).
