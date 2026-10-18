import type { Metadata, Viewport } from "next";
import Script from "next/script";

import { headers } from "next/headers";

import { languageCodeForPath } from "@/lib/seo/language-pages";
import { siteUrl } from "@/lib/seo/site";
import { AuthListener } from "@/components/auth-listener";
import { getUiLang } from "@/lib/i18n/server";
import { UiLangProvider } from "@/lib/i18n/use-ui-lang";
import { ClientErrorListener } from "@/components/client-error-listener";

import "./globals.css";
import { ServiceWorkerRegister } from "./service-worker-register";

const DESCRIPTION =
  "Your personal FM: songs made for you in Kannada, Tamil, Telugu, Hindi and Bengali. Lyrics written natively, performed by a singer, and checked for pronunciation.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: "neo-fm",
  description: DESCRIPTION,
  applicationName: "neo-fm",
  openGraph: {
    type: "website",
    siteName: "neo-fm",
    title: "neo-fm: your personal FM, in your language",
    description: DESCRIPTION,
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "neo-fm: your personal FM, in your language",
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
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const lang = await getUiLang();
  // The per-language SEO pages are written in that language, whatever the visitor's UI language is.
  const htmlLang = languageCodeForPath((await headers()).get("x-pathname")) ?? lang;
  return (
    <html lang={htmlLang}>
      <body>
        <UiLangProvider initial={lang}>
        {/* Applies persisted theme before paint; static file served from
            /public so no inline-script audit surface. */}
        <Script src="/theme-boot.js" strategy="beforeInteractive" />
        <AuthListener />
        <ClientErrorListener />
        {children}
        <ServiceWorkerRegister />
        </UiLangProvider>
      </body>
    </html>
  );
}
