/**
 * Next.js App Router Web App Manifest (Sprint 4 PWA).
 *
 * Emits /manifest.webmanifest with display=standalone so neo-fm can be
 * installed on iOS/Android home screens and on desktop Chrome / Edge.
 *
 * Pairs with `apps/web/public/sw.js` (service worker) which provides
 * the offline library shell. The shell is registered from the layout.
 */
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "neo-fm",
    short_name: "neo-fm",
    description:
      "India-first, composition-aware AI music. Carnatic, Hindustani, " +
      "Kannada folk, Western — generate songs with raga / tala / script.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0612",
    theme_color: "#321656",
    orientation: "portrait",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    categories: ["music", "entertainment", "art"],
  };
}
