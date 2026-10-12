/**
 * neo-fm service worker (Sprint 4 PWA).
 *
 * Strategy:
 *   1. Pre-cache the bare app shell + offline page on install so a
 *      cold-start when offline still shows something.
 *   2. Network-first for navigation + /api/* (we always prefer live
 *      data; if the network fails for a navigation we serve the
 *      offline shell from cache).
 *   3. Cache-first for /_next/static, icons, manifest (immutable assets).
 *   4. Bypass for Supabase storage (signed URLs are time-bound; we
 *      never want a stale URL served from cache).
 */
const CACHE_VERSION = "neo-fm-v2";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const MAX_PAGES = 20;

// Only what is identical for every visitor. Signed-in pages (/library,
// /songs/...) are deliberately NOT precached or runtime-cached: they are
// per-user, and a shared device must never serve one user's HTML to the
// next. Offline navigations to those fall back to /offline.
const SHELL_ROUTES = [
  "/offline",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-192.png",
  "/icon-maskable-512.png",
];

// Public marketing pages that are safe to serve from cache when offline.
const CACHEABLE_PAGES = new Set(["/", "/discover", "/pricing", "/trust", "/help", "/templates"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Best-effort precache; we don't fail install if any single
      // resource is missing (e.g. /offline before deploy bundles it).
      await Promise.all(
        SHELL_ROUTES.map(async (url) => {
          try {
            const res = await fetch(url, { credentials: "include" });
            if (res.ok) await cache.put(url, res.clone());
          } catch {
            // ignore
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => !n.startsWith(CACHE_VERSION))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

function isSupabaseStorage(url) {
  return (
    url.hostname.endsWith(".supabase.co") &&
    url.pathname.startsWith("/storage/")
  );
}

function isStatic(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".webmanifest")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache signed Storage URLs.
  if (isSupabaseStorage(url)) return;

  // Static assets: cache-first.
  if (isStatic(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  // Navigations: network-first, fall back to cached shell or /offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          // Don't cache API responses or auth-redirected pages.
          if (
            res.ok &&
            !res.redirected &&
            CACHEABLE_PAGES.has(url.pathname) &&
            res.headers.get("content-type")?.includes("text/html")
          ) {
            const cache = await caches.open(SHELL_CACHE);
            await cache.put(req, res.clone());
            const keys = await cache.keys();
            if (keys.length > MAX_PAGES + SHELL_ROUTES.length) {
              await cache.delete(keys[SHELL_ROUTES.length]);
            }
          }
          return res;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const hit = await cache.match(req);
          if (hit) return hit;
          return (
            (await cache.match("/offline")) ??
            new Response(
              "<h1>Offline</h1><p>neo-fm needs an internet connection " +
                "to generate songs.</p>",
              {
                status: 503,
                headers: { "content-type": "text/html; charset=utf-8" },
              },
            )
          );
        }
      })(),
    );
    return;
  }

  // API + everything else: network only. Never answer /api from cache.
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    (async () => {
      try {
        return await fetch(req);
      } catch (e) {
        const cache = await caches.open(SHELL_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        throw e;
      }
    })(),
  );
});
