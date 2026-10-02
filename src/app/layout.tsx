import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PostFlow",
  description: "Discover, research, draft and publish — with you in control.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans text-[15px]">{children}</body>
    </html>
  );
}
