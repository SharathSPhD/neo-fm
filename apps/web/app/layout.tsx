import type { Metadata, Viewport } from "next";
import Script from "next/script";

import { siteUrl } from "@/lib/seo/site";
import { AuthListener } from "@/components/auth-listener";

import "./globals.css";
import { ServiceWorkerRegister } from "./service-worker-register";

const DESCRIPTION =
  "AI songs in Kannada, Tamil, Telugu, Hindi and Bengali. Lyrics written natively, performed by a singer, and checked for pronunciation.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: "neo-fm",
  description: DESCRIPTION,
  applicationName: "neo-fm",
  openGraph: {
    type: "website",
    siteName: "neo-fm",
    title: "neo-fm: AI songs in Indian languages",
    description: DESCRIPTION,
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "neo-fm: AI songs in Indian languages",
    description: DESCRIPTION,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "neo-fm",
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#321656",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {/* Applies persisted theme before paint; static file served from
            /public so no inline-script audit surface. */}
        <Script src="/theme-boot.js" strategy="beforeInteractive" />
        <AuthListener />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
