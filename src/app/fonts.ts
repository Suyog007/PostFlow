import { Fraunces, IBM_Plex_Mono, Inter } from "next/font/google";

// PostFlow's type: an editorial serif for titles (with italics for the words that matter), a clean
// sans for reading, and a mono for times and small labels. Downloaded at build time, served from this site.
export const display = Fraunces({ subsets: ["latin"], style: ["normal", "italic"], axes: ["opsz", "SOFT"], variable: "--font-display", display: "swap" });
export const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
export const typed = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-type", display: "swap" });
