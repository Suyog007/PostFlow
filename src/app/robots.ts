import type { MetadataRoute } from "next";

const SITE = (process.env.APP_URL || process.env.URL || "http://localhost:3000").replace(/\/$/, "");

/** Search engines may read the public pages; the app, the API and account pages stay out. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/terms", "/privacy", "/signup", "/login"], disallow: ["/api/", "/calendar", "/posts/", "/create", "/notes", "/settings", "/billing", "/account", "/admin", "/verify-email", "/reset", "/forgot"] }],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
