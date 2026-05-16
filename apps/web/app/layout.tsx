import type { Metadata, Viewport } from "next";
import Script from "next/script";

import { AuthListener } from "@/components/auth-listener";

import "./globals.css";
import { ServiceWorkerRegister } from "./service-worker-register";

export const metadata: Metadata = {
  title: "neo-fm",
  description: "India-first, composition-aware AI music platform.",
  applicationName: "neo-fm",
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
