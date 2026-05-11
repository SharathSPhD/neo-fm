import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "neo-fm",
  description: "India-first, composition-aware AI music platform.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
