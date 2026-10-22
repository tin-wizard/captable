import { Inter, Roboto_Mono } from "next/font/google";

// One typeface everywhere: Inter (headings included)
export const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-roboto-mono",
  adjustFontFallback: false,
});
