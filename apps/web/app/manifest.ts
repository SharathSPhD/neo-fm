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

import { englishMainEnabled } from "@/lib/languages/english-main";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "neo-fm",
    short_name: "neo-fm",
    description:
      "Your personal 24/7 FM station. Music tuned to your taste, in " +
      (englishMainEnabled() ? "English, Hindi, Tamil, " : "Hindi, Tamil, ") +
      "Telugu, Kannada, Bengali and more. All music is AI-generated.",
    id: "/",
    start_url: "/station",
    scope: "/",
    lang: "en-IN",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    dir: "ltr",
    prefer_related_applications: false,
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
      { name: "Listen to your station", short_name: "Station", url: "/station", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Create a song", short_name: "Create", url: "/songs/new", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "My library", short_name: "Library", url: "/library", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
    categories: ["music", "entertainment", "art"],
  };
}
