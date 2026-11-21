import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DEPLO — Ship software with confidence",
  description:
    "A modern deployment workspace for GitHub repositories, ZIP uploads, and static websites.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
