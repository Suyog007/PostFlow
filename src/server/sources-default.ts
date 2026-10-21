import type { Pillar } from "./db/schema";

/** Starting feeds for every new account. Users add feeds for their own region or niche in Settings. */
export const DEFAULT_SOURCES: { name: string; url: string; pillar: Pillar; enabled?: boolean }[] = [
  // Tech and AI news
  { name: "Hacker News (150+ points)", url: "https://hnrss.org/frontpage?points=150", pillar: "news" },
  { name: "Hacker News: Show HN", url: "https://hnrss.org/show?points=80", pillar: "news" },
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", pillar: "news" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", pillar: "news" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", pillar: "news" },
  { name: "The Decoder (AI)", url: "https://the-decoder.com/feed/", pillar: "news" },
  { name: "OpenAI News", url: "https://openai.com/news/rss.xml", pillar: "news" },
  { name: "Google DeepMind", url: "https://deepmind.google/blog/rss.xml", pillar: "news" },
  { name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", pillar: "news" },
  { name: "GitHub Blog", url: "https://github.blog/feed/", pillar: "news" },
  { name: "Cloudflare Blog", url: "https://blog.cloudflare.com/rss/", pillar: "news" },
  { name: "Simon Willison", url: "https://simonwillison.net/atom/everything/", pillar: "news" },
  { name: "The Pragmatic Engineer", url: "https://newsletter.pragmaticengineer.com/feed", pillar: "news", enabled: false },
];
