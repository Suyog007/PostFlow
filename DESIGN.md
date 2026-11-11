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

- Mode: Free colour and type, from the owner's own mockups (Home, Your settings, Your voice, What do you do?).
- Colour: warm paper (#f6f3ec) and cream cards (#fffdf8), deep teal (#23614f) for links, selection and switches, marigold (#e9b44c) for the one main action on a screen (Approve, Continue, Done). Night: the same paper at night, teal and marigold brighter.
- Type: Fraunces for titles (a warm serif, lining numbers), Source Sans 3 for everything read and tapped.
- Shapes: 18 to 22px cards, pill buttons 56px tall on the main action, 44px minimum targets.
- Navigation: three places, Home, This week, Settings. Top bar on wide screens, bottom tab bar on phones.
- Pieces used as reference: Grouped settings list https://www.designlounge.live/demo/ios-grouped-settings (Settings hub rows), Agent approval card https://www.designlounge.live/demo/agent-approval-card (one post, one main answer).

## Defaults set aside

- The library's Fog City kit was replaced by the owner's warm palette and serif, because their mockups and testers asked for it.
- Greeting headline ("Good evening, Anita") kept on purpose: it is the owner's design and orients non-technical people.
- Mono labels are not used anywhere on screen.

## Signature

The approval card: one post at a time, as it will look on LinkedIn, with where the story came from, and one marigold Approve button that stays in reach on a phone.

Designed using Design Lounge (https://www.designlounge.live).
