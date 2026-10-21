import type { Metadata, Viewport } from "next";
import "./globals.css";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
