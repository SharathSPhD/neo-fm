"use client";

/**
 * Client-side service-worker registration for the neo-fm PWA. Mounted
 * once from the root layout. Registers /sw.js at root scope. Errors
 * are swallowed because a missing SW must never break the app.
 */
import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {
          // ignore - SW is best-effort
        });
    };
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
  }, []);
  return null;
}
