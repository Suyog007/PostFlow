import { Fraunces, JetBrains_Mono, Source_Sans_3 } from "next/font/google";

// PostFlow's type: Fraunces for titles (a warm serif that reads like a good letter), Source Sans 3 for
// everything you read and tap, a mono only for code. Downloaded at build time, served from this site.
export const display = Fraunces({ subsets: ["latin"], axes: ["opsz"], variable: "--font-display", display: "swap" });
export const body = Source_Sans_3({ subsets: ["latin"], variable: "--font-body", display: "swap" });
export const typed = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-type", display: "swap" });
