/** Ready-made voices for "How you sound". Shared by the picker and the Settings list. */
export const TONES = [
  { label: "Friendly and simple", text: "Friendly and simple. Short sentences, everyday words, like explaining it to a smart friend. No jargon, no hype." },
  { label: "Expert and precise", text: "Expert and precise. Specific facts and numbers, a clear point of view, calm and confident. No hype." },
  { label: "Short and punchy", text: "Short and punchy. One idea per line, strong first line, no filler words. No hype." },
  { label: "Warm and personal", text: "Warm and personal. First person, a little story or feeling where it fits, kind and encouraging. No hype." },
];

/** The preset a voice matches, or a short description when it is the person's own words. */
export function toneLabel(voice: string): string {
  return TONES.find((t) => t.text === voice.trim())?.label ?? (voice.trim() ? "Your own words" : "Not set");
}
