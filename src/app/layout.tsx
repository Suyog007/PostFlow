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

/** Light, dark or the device's setting (no attribute), as picked with the theme toggle. */
const THEME_SCRIPT = `try{var t=localStorage.getItem("postflow-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cfToken = env().CF_ANALYTICS_TOKEN;
  return (
    // The theme script sets data-theme before the first paint, so a chosen theme never flashes the other one.
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${body.variable} ${typed.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
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
