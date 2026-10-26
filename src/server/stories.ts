// Spotting the same story across outlets, from titles alone (no model call).

const STOP = new Set(
  "the and for are you your its can all not but has have had will was were been with from that this what when where which who whom how why new now just out get gets got use uses using used make makes made way one two three first last year years day days week weeks more most than about over into after before under says said say show ask tell launches launch launched releases release released adds add added via per off our their they them there here then also only some any each every own big top best against still even back being while again across without within behind ahead start head takes take puts put give gives find finds found cut cuts lets let may might could would should must today yesterday tomorrow longer early late latest next behind like than many much lot lots ever never really".split(" "),
);

/** Names and words that show up in many unrelated tech stories, so sharing one says nothing. */
const GENERIC = new Set(
  "openai google microsoft apple meta amazon aws nvidia anthropic claude gemini gpt chatgpt github cloudflare vercel netlify stripe hugging face deepmind mistral deepseek tesla samsung intel amd ibm oracle model models agent agents agentic api apis llm llms open source code coding coder developer developers dev devs app apps data cloud web software tool tools startup startups company companies users user team teams security secure vulnerability vulnerabilities flaw flaws bug bugs attack attacks attacker hackers hacker hack hacked breach update updates beta version feature features platform service services system systems free price pricing cost costs faster fast better world internet million millions billion report reports study research paper".split(" "),
);

export function titleTokens(title: string): string[] {
  const words = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ");
  // "php2shell" also counts as "php" and "shell", so it matches headlines that just say "PHP".
  const parts = words.flatMap((w) => (/[a-z]/.test(w) && /\d/.test(w) ? [w, ...w.split(/\d+/)] : [w]));
  return [...new Set(parts.filter((w) => w.length >= 3 && /[a-z]/.test(w) && !STOP.has(w) && !GENERIC.has(w)))];
}

/**
 * Story keys: words that at least two titles share but that are rare across the whole set,
 * such as "php2shell" or "connectwise". Common names ("openai", "google") appear in too many titles to count.
 */
export function storyKeys(corpus: string[]): (title: string) => string[] {
  const df = new Map<string, number>();
  for (const t of corpus) for (const w of titleTokens(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const max = Math.max(8, Math.floor(corpus.length * 0.15));
  return (title) =>
    titleTokens(title).filter((w) => {
      const n = df.get(w) ?? 0;
      return n >= 2 && n <= max;
    });
}

/** For each item, how many other outlets ran a story sharing one of its story keys. */
export function coverage(items: { id: string; title: string; sourceId: string | null }[]): Map<string, number> {
  const keysOf = storyKeys(items.map((i) => i.title));
  const sourcesByKey = new Map<string, Set<string>>();
  const keys = new Map<string, string[]>();
  for (const it of items) {
    const k = keysOf(it.title);
    keys.set(it.id, k);
    for (const w of k) {
      if (!sourcesByKey.has(w)) sourcesByKey.set(w, new Set());
      sourcesByKey.get(w)!.add(it.sourceId ?? it.id);
    }
  }
  const out = new Map<string, number>();
  for (const it of items) {
    const others = new Set<string>();
    for (const w of keys.get(it.id) ?? []) for (const src of sourcesByKey.get(w) ?? []) if (src !== (it.sourceId ?? it.id)) others.add(src);
    out.set(it.id, others.size);
  }
  return out;
}

/** Story keys plus the "hot" ones: keys that at least three different outlets are using right now. */
export function storyIndex(corpus: { title: string; sourceId: string | null; id?: string }[]) {
  const keysOf = storyKeys(corpus.map((c) => c.title));
  const sources = new Map<string, Set<string>>();
  corpus.forEach((c, i) => {
    for (const w of keysOf(c.title)) {
      if (!sources.has(w)) sources.set(w, new Set());
      sources.get(w)!.add(c.sourceId ?? c.id ?? `#${i}`);
    }
  });
  // Proper names (capitalised mid-title, like "ConnectWise" or "PHP2Shell") pin a story down with just two outlets.
  const proper = new Set<string>();
  for (const c of corpus) {
    c.title.split(/\s+/).slice(1).forEach((raw) => {
      if (/[A-Z]/.test(raw)) for (const w of titleTokens(raw)) proper.add(w);
    });
  }
  const hot = new Set([...sources].filter(([w, s]) => s.size >= 3 || (s.size >= 2 && proper.has(w))).map(([w]) => w));
  return { keysOf, hot };
}

/** Same story: two shared story keys, or one key that several outlets are running with. */
export function sameStory(index: { keysOf: (title: string) => string[]; hot: Set<string> }, a: string, b: string): boolean {
  const kb = new Set(index.keysOf(b));
  const shared = index.keysOf(a).filter((w) => kb.has(w));
  return shared.length >= 2 || shared.some((w) => index.hot.has(w)) || closeHeadlines(a, b);
}

/** Meaningful words of a headline, names included, with plurals folded ("models" = "model"). */
function headlineWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length >= 3 && /[a-z]/.test(w) && !STOP.has(w))
      .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)),
  );
}

/**
 * Two headlines about the same event in different words: "OpenAI disables internet access during model
 * training" and "OpenAI will stop training its models on the live internet" share openai, internet and
 * training. Three shared words that make up a good part of the shorter headline.
 */
export function closeHeadlines(a: string, b: string): boolean {
  const wa = headlineWords(a);
  const wb = headlineWords(b);
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared >= 3 && shared / Math.min(wa.size, wb.size) >= 0.4;
}
