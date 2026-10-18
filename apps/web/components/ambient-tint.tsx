"use client";

import { useAmbientTint } from "./use-ambient-tint";

/** Drop into a server page to tint the ambient background from a seed (e.g. the song id). */
export function AmbientTint({ seed }: { seed: string }) {
  useAmbientTint(seed);
  return null;
}
