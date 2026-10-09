import { Inter, Inter_Tight, Roboto_Mono } from "next/font/google";

// TIN's typefaces (tin.info): Inter for text, Inter Tight for headings
export const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const interTight = Inter_Tight({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter-tight",
});

export const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-roboto-mono",
  adjustFontFallback: false,
});
