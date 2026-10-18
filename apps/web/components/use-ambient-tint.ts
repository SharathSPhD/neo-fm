"use client";

import { useEffect } from "react";

import { trackTint } from "@/lib/ui/tint";

/**
 * Tints the ambient background from a seed (usually the playing track id) and
 * restores the daypart palette when the seed is null or the page unmounts.
 */
export function useAmbientTint(seed: string | null) {
  useEffect(() => {
    if (!seed) return;
    const root = document.documentElement;
    const tint = trackTint(seed);
    root.style.setProperty("--tint-a", tint.a);
    root.style.setProperty("--tint-b", tint.b);
    root.style.setProperty("--tint-c", tint.c);
    root.setAttribute("data-tint", "1");
    return () => {
      root.removeAttribute("data-tint");
      root.style.removeProperty("--tint-a");
      root.style.removeProperty("--tint-b");
      root.style.removeProperty("--tint-c");
    };
  }, [seed]);
}
