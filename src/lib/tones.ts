// "How you sound": three voices, each shown as the same small story written that way, so people pick
// the post they would actually publish instead of describing a style in the abstract.

export const TONES = [
  {
    id: "warm",
    label: "Warm and plain",
    summary: "You sound warm and plain, like you're explaining something to someone you help.",
    text: "Warm and plain. Short sentences, everyday words, like explaining it to someone you help. Kind, never preachy. No jargon, no hype.",
  },
  {
    id: "short",
    label: "Short and direct",
    summary: "You keep it short and direct: the news, then what to do.",
    text: "Short and direct. The news in the first line, then what it means. One idea per line, no filler words. No hype.",
  },
  {
    id: "formal",
    label: "A little more formal",
    summary: "You sound careful and formal, like a note to colleagues.",
    text: "A little more formal. Complete sentences, precise terms, calm and measured, like a note to colleagues. No hype.",
  },
] as const;

export type ToneId = (typeof TONES)[number]["id"];

/** The same story in each voice, per field, so the samples feel like their own work. */
const SAMPLES: Record<string, Record<ToneId, string>> = {
  health: {
    warm: "Nepal's health ministry moved the first measles dose to 9 months. If you have a young child, ask your clinic which schedule they are using. This is news, not medical advice.",
    short: "Change to Nepal's childhood vaccine schedule: measles dose now at 9 months. Check with your clinic. Not medical advice.",
    formal: "The Ministry of Health and Population has updated the national immunisation schedule, bringing the first measles dose forward to 9 months of age. Families should confirm timing with their own clinician.",
  },
  finance: {
    warm: "Good news for small businesses: you can now earn up to £90,000 a year before you must register for VAT. If you were close to the old limit, you have a little more room to grow.",
    short: "UK VAT threshold is now £90,000, up from £85,000. More room before you register.",
    formal: "HMRC has raised the VAT registration threshold to £90,000, effective 1 April 2024. Businesses near the previous £85,000 limit should review their position.",
  },
  law: {
    warm: "A new rule means tenants must now get two months' notice before a rent rise. If you rent, keep the letter and check the date it arrived.",
    short: "New rule: two months' notice before any rent rise. Keep the letter, check the date.",
    formal: "Landlords are now required to give tenants two months' written notice of any rent increase. Tenants are advised to retain the notice and record its date of receipt.",
  },
  education: {
    warm: "The exam board has moved this year's science practicals to March. If your child is in Year 11, it's worth checking their revision plan now.",
    short: "Science practicals move to March this year. Year 11: check your revision plan.",
    formal: "The examination board has rescheduled this year's science practical assessments to March. Schools and families should review Year 11 preparation timetables.",
  },
  marketing: {
    warm: "LinkedIn now shows how many people saved your post. It's a small change, but it tells you what people want to come back to, not just what they liked.",
    short: "LinkedIn now shows post saves. Better signal than likes. Watch it.",
    formal: "LinkedIn has added saves to post analytics. The metric offers a clearer indication of lasting interest than reactions alone.",
  },
  tech: {
    warm: "A bug in a popular image library lets a crafted picture run code on a server. If your app resizes uploads, you're probably using it, so update this week.",
    short: "Image library bug: a crafted picture can run code on your server. Fixed today. Update now.",
    formal: "A vulnerability in a widely used image library allows a crafted image to execute code on the server. A fix was released today; affected applications should update promptly.",
  },
  other: {
    warm: "A new rule in your field starts next month. It's a small change, but it affects most people you work with, so here's what it means in plain words.",
    short: "New rule starts next month. Here's what changes for you, in three lines.",
    formal: "A new regulation in the sector takes effect next month. This note summarises its main provisions and who they apply to.",
  },
};

export function toneSamples(field: string) {
  const s = SAMPLES[field] ?? SAMPLES.other;
  return TONES.map((t) => ({ ...t, sample: s[t.id] }));
}

export function toneOf(voice: string) {
  return TONES.find((t) => t.text === voice.trim());
}

/** One plain sentence for the Settings hub. */
export function toneSummary(voice: string): string {
  const t = toneOf(voice);
  if (t) return t.summary;
  const v = voice.trim();
  if (!v) return "Not set yet. Pick the post that sounds like you.";
  return `In your own words: “${v.length > 70 ? `${v.slice(0, 68).trimEnd()}…` : v}”`;
}

/** Things people in each field usually never want in a post. Tapped on or off as chips. */
export const NEVER: Record<string, string[]> = {
  health: ["Medical advice", "Patients' names", "Politics", "Other clinics by name", "Prices or fees"],
  finance: ["Investment tips", "Client names", "Politics", "Rumours", "Prices or fees"],
  law: ["Legal advice", "Client names", "Ongoing cases", "Politics"],
  education: ["Students' names", "Politics", "Religion", "School gossip"],
  marketing: ["Client names", "Made-up results", "Competitors by name", "Politics"],
  tech: ["Politics", "Religion", "My employer", "Rumours", "Competitors by name"],
  other: ["Politics", "Religion", "Rumours", "My employer"],
};

/** Saved "never write about" text, as separate items. */
export function splitNever(avoid: string): string[] {
  return [...new Set(avoid.split(/[,.;\n]+/).map((x) => x.trim()).filter(Boolean))];
}
