import type { MetadataRoute } from "next";

const SITE = (process.env.APP_URL || process.env.URL || "http://localhost:3000").replace(/\/$/, "");

const PRIVATE = ["/api/", "/calendar", "/week", "/posts/", "/create", "/notes", "/settings", "/billing", "/account", "/admin", "/welcome", "/verify-email", "/reset", "/forgot"];
const PUBLIC = ["/", "/terms", "/privacy", "/signup", "/login", "/llms.txt"];
// Answer and AI engines are welcome on the public pages, so they can describe PostFlow correctly.
const AI_CRAWLERS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot"];

/** Search engines and AI crawlers may read the public pages; the app, the API and account pages stay out. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: PUBLIC, disallow: PRIVATE },
      { userAgent: AI_CRAWLERS, allow: PUBLIC, disallow: PRIVATE },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
