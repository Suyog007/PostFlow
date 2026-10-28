import type { Metadata, Viewport } from "next";
import "./globals.css";
import { body, display, typed } from "./fonts";
import { SourceTracker } from "@/components/source-tracker";
import { env } from "@/server/env";

// Netlify sets URL to the site's main address; APP_URL is the app's own setting.
const SITE_URL = process.env.APP_URL || process.env.URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "PostFlow",
  description: "Your LinkedIn and X presence on autopilot.",
  // The app stays out of search results; the landing page opts back in.
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

/**
 * Runs while <head> is parsed, before React hydrates:
 * 1. Light, dark or the device's setting (no attribute), as picked with the theme toggle.
 * 2. Removes whitespace text and comments that a host inserted into <head> (Netlify adds a
 *    "This site is hosted on Netlify" comment plus a newline on *.netlify.app). React 19 skips stray
 *    tags in <head> but not stray text, so without this every page failed hydration (error #418),
 *    was re-rendered from scratch, and lost the chosen theme.
 */
const HEAD_SCRIPT = `try{var t=localStorage.getItem("postflow-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}try{for(var n=document.head.firstChild;n;){var x=n.nextSibling;if(n.nodeType===8||(n.nodeType===3&&!/\\S/.test(n.nodeValue)))n.parentNode.removeChild(n);n=x}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cfToken = env().CF_ANALYTICS_TOKEN;
  return (
    // The theme script sets data-theme before the first paint, so a chosen theme never flashes the other one.
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${body.variable} ${typed.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: HEAD_SCRIPT }} />
        {/* Cloudflare Web Analytics: free visitor counts without cookies. Only loads when the token is set. */}
        {cfToken && <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon={JSON.stringify({ token: cfToken })} />}
      </head>
      <body className="min-h-screen">
        {children}
        <SourceTracker />
      </body>
    </html>
  );
}
