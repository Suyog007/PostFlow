/**
 * Starting set of sources. All configurable in Settings; reachability verified on 2026-10-19.
 * Two groups ship enabled: AI news/research, and "builder signal" — discussions, launches
 * and engineering practice that surface opportunities and practical info, not just news.
 * Everything else ships disabled so the desk stays focused. Flip any source in Settings.
 */
export const DEFAULT_SOURCES: {
  name: string;
  kind: "rss" | "github_search";
  url: string;
  topicHint: string;
  isPrimary?: boolean;
  pollIntervalMinutes?: number;
  config?: Record<string, unknown>;
  enabled?: boolean;
}[] = [
  // AI labs and official announcements
  { name: "OpenAI News", kind: "rss", url: "https://openai.com/news/rss.xml", topicHint: "ai", isPrimary: true },
  { name: "Google DeepMind Blog", kind: "rss", url: "https://deepmind.google/blog/rss.xml", topicHint: "ai", isPrimary: true },
  { name: "Google AI Blog", kind: "rss", url: "https://blog.google/technology/ai/rss/", topicHint: "ai", isPrimary: true },
  { name: "Google Research Blog", kind: "rss", url: "https://research.google/blog/rss/", topicHint: "research", isPrimary: true, pollIntervalMinutes: 360 },
  { name: "Hugging Face Blog", kind: "rss", url: "https://huggingface.co/blog/feed.xml", topicHint: "ai", isPrimary: true },
  { name: "NVIDIA Blog", kind: "rss", url: "https://blogs.nvidia.com/feed/", topicHint: "ai", isPrimary: true },
  { name: "MIT News — AI", kind: "rss", url: "https://news.mit.edu/rss/topic/artificial-intelligence2", topicHint: "research", isPrimary: true },
  // AI analysis, newsletters and roundups
  { name: "The Decoder", kind: "rss", url: "https://the-decoder.com/feed/", topicHint: "ai" },
  { name: "TLDR AI", kind: "rss", url: "https://tldr.tech/api/rss/ai", topicHint: "ai", pollIntervalMinutes: 240 },
  { name: "AI News (smol.ai)", kind: "rss", url: "https://news.smol.ai/rss.xml", topicHint: "ai", pollIntervalMinutes: 240 },
  { name: "Simon Willison", kind: "rss", url: "https://simonwillison.net/atom/everything/", topicHint: "ai", pollIntervalMinutes: 240 },
  { name: "Import AI — Jack Clark", kind: "rss", url: "https://importai.substack.com/feed", topicHint: "ai policy and research", pollIntervalMinutes: 720 },
  { name: "Interconnects — Nathan Lambert", kind: "rss", url: "https://www.interconnects.ai/feed", topicHint: "ai analysis", pollIntervalMinutes: 360 },
  { name: "One Useful Thing — Ethan Mollick", kind: "rss", url: "https://www.oneusefulthing.org/feed", topicHint: "ai in practice", pollIntervalMinutes: 720 },
  // GitHub (official REST search API), AI-focused
  {
    name: "GitHub — new AI repos gaining stars",
    kind: "github_search",
    url: "https://api.github.com/search/repositories",
    topicHint: "open-source AI tools",
    isPrimary: true,
    pollIntervalMinutes: 720,
    config: { query: "topic:ai created:>{{days:21}} stars:>200", perPage: 20 },
  },
  {
    name: "GitHub — active AI agent projects",
    kind: "github_search",
    url: "https://api.github.com/search/repositories#agents",
    topicHint: "AI models and agents",
    isPrimary: true,
    pollIntervalMinutes: 720,
    config: { query: "topic:ai-agents pushed:>{{days:7}} stars:>500", perPage: 15 },
  },
  // Builder signal: opportunities, launches and practice (not news)
  { name: "Hacker News (150+ points)", kind: "rss", url: "https://hnrss.org/frontpage?points=150", topicHint: "technology and builder discussions", pollIntervalMinutes: 120 },
  { name: "Hacker News — Show HN", kind: "rss", url: "https://hnrss.org/show?points=50", topicHint: "what people are building", pollIntervalMinutes: 180 },
  { name: "Hacker News — Ask HN", kind: "rss", url: "https://hnrss.org/ask", topicHint: "builder problems and questions", pollIntervalMinutes: 360 },
  { name: "Reddit — r/SideProject", kind: "rss", url: "https://www.reddit.com/r/SideProject/.rss", topicHint: "what people are building", pollIntervalMinutes: 360 },
  { name: "Reddit — r/SaaS", kind: "rss", url: "https://www.reddit.com/r/SaaS/.rss", topicHint: "SaaS growth, pricing and distribution", pollIntervalMinutes: 360 },
  { name: "Product Hunt", kind: "rss", url: "https://www.producthunt.com/feed", topicHint: "product launches", pollIntervalMinutes: 360 },
  { name: "Y Combinator Blog", kind: "rss", url: "https://www.ycombinator.com/blog/rss", topicHint: "startups and funding", isPrimary: true, pollIntervalMinutes: 720 },
  { name: "GitHub Blog", kind: "rss", url: "https://github.blog/feed/", topicHint: "developer tools", isPrimary: true, pollIntervalMinutes: 360 },
  { name: "Cloudflare Blog", kind: "rss", url: "https://blog.cloudflare.com/rss/", topicHint: "engineering practice", pollIntervalMinutes: 720 },
  { name: "The Pragmatic Engineer", kind: "rss", url: "https://newsletter.pragmaticengineer.com/feed", topicHint: "engineering practice and careers", pollIntervalMinutes: 720 },
  { name: "Julia Evans", kind: "rss", url: "https://jvns.ca/atom.xml", topicHint: "engineering practice and tools", pollIntervalMinutes: 720 },
  // --- Available but disabled by default: toggle on in Settings ---
  // Research (broader than AI)
  { name: "Microsoft Research Blog", kind: "rss", url: "https://www.microsoft.com/en-us/research/feed/", topicHint: "research", isPrimary: true, pollIntervalMinutes: 360, enabled: false },
  { name: "Amazon Science", kind: "rss", url: "https://www.amazon.science/index.rss", topicHint: "research", isPrimary: true, pollIntervalMinutes: 360, enabled: false },
  { name: "arXiv cs.AI (new papers)", kind: "rss", url: "https://export.arxiv.org/rss/cs.AI", topicHint: "research", pollIntervalMinutes: 720, enabled: false },
  // General technology
  { name: "Techmeme", kind: "rss", url: "https://www.techmeme.com/feed.xml", topicHint: "technology", pollIntervalMinutes: 120, enabled: false },
  { name: "TechCrunch", kind: "rss", url: "https://techcrunch.com/feed/", topicHint: "technology", enabled: false },
  { name: "TechCrunch Startups", kind: "rss", url: "https://techcrunch.com/category/startups/feed/", topicHint: "startups and funding", enabled: false },
  { name: "The Verge", kind: "rss", url: "https://www.theverge.com/rss/index.xml", topicHint: "technology", enabled: false },
  { name: "Ars Technica", kind: "rss", url: "https://feeds.arstechnica.com/arstechnica/index", topicHint: "technology", enabled: false },
  { name: "MIT Technology Review", kind: "rss", url: "https://www.technologyreview.com/feed/", topicHint: "technology", enabled: false },
  { name: "BBC Technology", kind: "rss", url: "https://feeds.bbci.co.uk/news/technology/rss.xml", topicHint: "technology", enabled: false },
  // Products, startups, ecosystems
  { name: "Sequoia Capital", kind: "rss", url: "https://www.sequoiacap.com/feed/", topicHint: "economics and strategy", pollIntervalMinutes: 720, enabled: false },
  // Science & ideas
  { name: "Quanta Magazine", kind: "rss", url: "https://www.quantamagazine.org/feed/", topicHint: "science and society", pollIntervalMinutes: 720, enabled: false },
  // Nepal
  { name: "The Kathmandu Post", kind: "rss", url: "https://kathmandupost.com/rss", topicHint: "Nepal", enabled: false },
  { name: "Onlinekhabar English", kind: "rss", url: "https://english.onlinekhabar.com/feed", topicHint: "Nepal", enabled: false },
  { name: "Techpana", kind: "rss", url: "https://techpana.com/feed", topicHint: "Nepal technology", enabled: false },
  { name: "Khabarhub", kind: "rss", url: "https://khabarhub.com/feed", topicHint: "Nepal", enabled: false },
  { name: "The Himalayan Times", kind: "rss", url: "https://thehimalayantimes.com/rssFeed/15", topicHint: "Nepal", enabled: false },
];
