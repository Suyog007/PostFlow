import { Bricolage_Grotesque, Courier_Prime, Inter } from "next/font/google";

// PostFlow's type: a tight, characterful display face for titles, a clean body face, and a typewriter
// face for times and small notes. Downloaded at build time and served from this site.
export const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-display", display: "swap" });
export const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
export const typed = Courier_Prime({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-type", display: "swap" });
