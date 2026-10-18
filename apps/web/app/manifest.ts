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
      "Your personal FM. Songs made for you in Kannada, Tamil, Telugu, Hindi and " +
      "Bengali, with native lyrics and a pronunciation check.",
    id: "/",
    start_url: "/library",
    scope: "/",
    lang: "en-IN",
    display: "standalone",
    background_color: "#0a0612",
    theme_color: "#321656",
    orientation: "any",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Dedicated maskable art with the logo inside the 80% safe zone, so
      // Android's adaptive-icon masks never crop it.
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Create a song", short_name: "Create", url: "/songs/new", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "My library", short_name: "Library", url: "/library", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
    categories: ["music", "entertainment", "art"],
  };
}
