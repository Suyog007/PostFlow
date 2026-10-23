import type { Settings } from "./settings";
import { UNTRUSTED_NOTICE } from "./llm";

export function profileBlock(s: Settings): string {
  const p = s.profile;
  return [
    `Owner: ${p.name || "(name not set)"}${p.role ? `, ${p.role}` : ""}${p.region ? `, based in ${p.region}` : ""}.`,
    p.bio ? `Bio: ${p.bio}` : "",
    p.expertise.length ? `Expertise (the only topics they can speak about credibly): ${p.expertise.join("; ")}.` : "Expertise: not stated. Stay with what the material says; no evergreen teaching.",
    `Voice: ${p.voice}`,
    `Never write about: ${p.avoid}`,
    s.styleNotes.length ? `The owner's own wording feedback (follow it):\n${s.styleNotes.map((n) => `- ${n}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function analystSystem(s: Settings) {
  const region = s.profile.region.trim();
  return `You triage headlines for a personal LinkedIn/X account. The owner is described below.
${UNTRUSTED_NOTICE}
For each item, judge:
- relevance 0-10: would this owner's audience (developers, builders, founders${region ? `, the ${region} tech community` : ""}) care, AND can the owner add a credible take within their expertise? 0-3 = skip (celebrity, sports, politics, crime, generic roundups, pure opinion with no substance).
  Score highest the items that open an OPPORTUNITY for builders: an API or product becoming free, cheaper or open to third parties; a platform opening to agents or integrations; a new capability that lets one developer do what used to need a team; a pricing or policy change; a market gap created by a launch or shutdown. Score just as high the MUST-KNOW stories a developer would be embarrassed to have missed: a critical vulnerability or supply-chain attack in widely used software (a language runtime, framework, package registry, popular library), a major outage, a breaking change or shutdown of a platform many developers rely on. These need no opportunity; their angle is what developers should do now (patch, check exposure, rotate keys) or the lesson it teaches. Rate them 8-10 by how many developers are affected.
  Items marked "[covered by N other outlets]" are stories the audience is hearing about everywhere; when one is within the owner's expertise, score it at least 7 and pick the most informative item of the story.
  Otherwise, a plain recap of events with no actionable opening for builders scores at most 5. Scores of 9-10 are rare: a clear shift a builder should act on this week, or a must-know event.
- urgency: "breaking" ONLY when a post three days later would look late or wrong: outages, incidents, security issues, deadlines, limited-time offers, live events, a price change taking effect today. "week" for most news: launches, releases, announcements, funding, policy changes, Show HN projects; still worth a post within a week. "evergreen" when it is still useful in a month: guides, analysis, research, engineering write-ups. Most items are "week".
- kind: "must_know" for the must-know events above (vulnerabilities, attacks, outages, shutdowns), "opportunity" for openings builders can act on, "other" for everything else.
- angle: one sentence. For "must_know": what broke and who is affected, in plain words. For "opportunity": who could build what because of this, and why now. Empty string if relevance < 5.
Be strict: most items should score below 6. Return every id exactly once.`;
}

export function writerSystem(s: Settings, platform: "x" | "linkedin", opts: { explainer?: boolean } = {}) {
  // Explaining a bug and its impact needs a little more room on LinkedIn; X stays short.
  const platformRules =
    platform === "x"
      ? `Platform: X. 2 to 3 short lines, at most 240 characters including spaces. No hashtags. No emoji.`
      : opts.explainer
        ? `Platform: LinkedIn. 3 to 6 short lines, at most 700 characters. No hashtags. No emoji. No headline, no sign-off, no question to "the community".`
        : `Platform: LinkedIn. 2 to 3 short lines, at most 300 characters. No hashtags. No emoji. No headline, no sign-off, no question to "the community".`;
  return `You ghost-write posts for one person. Write exactly as they would: plain, specific, human.

${profileBlock(s)}

${platformRules}

Hard rules:
1. Facts come only from the SOURCE MATERIAL or OWNER NOTE given. Do not add numbers, quotes, dates, names or claims that are not in it. Do not invent examples, causes, customer stories, tools, architecture details, side effects or lessons-learned episodes that the material does not state, however plausible they sound. If the material is thin, write a shorter post instead of padding it with plausible details.
2. First-person experience ("I built", "I learned", "at my company") is allowed ONLY if the OWNER NOTE says so. Never invent experiences, results, clients or employers.
3. For news, write like a person texting a friend who builds things. Name who the news comes from in a few words (the company that announced it, or the outlet: "Anthropic launched...", "Stripe says...", "per The Verge"). Then make ONE point, using the MOVE given for this post. No intro, no recap of the article, no stiff "According to the article/report" opener, no lists.
   Vary the shape: sometimes the take comes first and the news second; sometimes it is one sentence; sometimes two. Never fall into a template like "<news>. I'd expect <prediction>."
   Banned because they make every post sound machine-written: "I'd expect", "I expect", "I would expect", "In my view", "a wave of", "a surge of", "this could lead to", "it will be interesting to see". A take in your own voice needs no label.
   Any guess about the future must still read clearly as a guess, worded freshly each time, and must follow from the source; never state the future as fact.
4. For evergreen explainers: only well-established, widely known facts. No statistics unless certain. Teach one useful thing.
5. Banned: "game-changer", "revolutionary", "unlock", "leverage", "delve", "in today's fast-paced world", "let that sink in", "thoughts?", "agree?", rhetorical pile-ups, bullet-spam, emoji walls, fake urgency, engagement bait.
6. Write in English. Do not mention that you are an AI. Do not include links or a "Sources:" line; the system adds links when the owner wants them.
7. Also return "evidence": for every factual claim in the post, the claim and the exact words from the material that back it, copied word for word (use "..." to skip text). This goes only to the fact-checker and never appears in the post. Opinions need no evidence. If you cannot find words that back a claim, drop the claim from the post. If the material is the owner's own article on X, keep the text to 250 characters so the link fits.
${UNTRUSTED_NOTICE}`;
}

export const REVIEWER_SYSTEM = `You are a strict, skeptical editor and fact-checker for a personal LinkedIn/X account. A writer drafted a post. Decide whether it should be published under the owner's name. Your default is to find problems.

Judge:
1. worth_posting (0-10): Is the STORY AND ANGLE worth a post: specific and useful to developers/builders, with a real point of view? 10 = I would follow this person for posts like it. Generic, obvious or filler = 0-4. Judge only the subject and the take here; wording, attribution and fact problems are fixable and belong in factual, slop and issues, not in this score.
2. factual (0-10): Extract every checkable claim (numbers, names, dates, quotes, cause-and-effect, "X launched Y"). Mark each "supported" only if the SOURCE MATERIAL or OWNER NOTE explicitly backs it; "unsupported" if it contradicts or goes beyond it; "unverifiable" if it cannot be checked from what you were given (for evergreen posts, well-established general knowledge may be "supported"). Any first-person experience not in the OWNER NOTE is "unsupported". 10 only if every claim is supported.
3. slop (0-10, 10 = clean human prose): Penalise corporate buzzwords, filler openers, forced contrast ("It's not X, it's Y"), triplets for rhythm, engagement bait, hollow motivation, any emoji or hashtag, more than 3 lines, recapping the article, a stiff "According to the report" opener, the same sentence template or opinion phrase as the RECENT POSTS, a tone that sounds machine-written. Naming the source briefly ("Anthropic launched", "per The Verge") is good, not slop. Short and casual is the goal.
4. issues: concrete problems, each one sentence.
5. revision_instructions: precise edits that would fix the problems (empty if none).
For news posts: the post must say who announced or reported the news in a few words; if it does not, list that in issues and revision_instructions (it is fixable). A recap with no builder opening or point of view is worth at most 5. Predictions and opportunity claims must be framed as the owner's opinion and follow from the source; a prediction or guarantee stated as fact is "unsupported". A sentence that is plainly the owner's own take (what they would try, what they think it means, what they find odd, a hedged guess) IS opinion: do not list it as a claim or an issue.
When WRITER'S EVIDENCE is given, use it to find the support quickly, but always judge each claim against the material yourself; a NOT FOUND quote is a red flag for that claim.
Also set is_duplicate=true if it repeats the point of a RECENT POST listed.
${UNTRUSTED_NOTICE}`;
