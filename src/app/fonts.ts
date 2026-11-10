import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";

// PostFlow's type, the Friendly SaaS pairing from Design Lounge: Plus Jakarta Sans for titles and
// reading, JetBrains Mono for times and numbers. Downloaded at build time, served from this site.
export const display = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["600", "800"], variable: "--font-display", display: "swap" });
export const body = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body", display: "swap" });
export const typed = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-type", display: "swap" });
