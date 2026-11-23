import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["italic"], variable: "--font-serif", display: "swap" });

export const metadata: Metadata = {
  title: "DEPLO",
  description: "Deploy GitHub repositories, ZIP uploads and HTML files to the edge.",
};

export const viewport: Viewport = { themeColor: "#090a17", colorScheme: "dark" };

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={sans.variable + " " + mono.variable + " " + serif.variable}>
      <body>{children}</body>
    </html>
  );
}
