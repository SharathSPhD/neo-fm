/**
 * Deterministic colour tint for a track, so the ambient background can follow
 * what is playing without fetching cover art. Same id, same colours.
 */
export type Tint = { a: string; b: string; c: string };

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** HSL triplets in the form the CSS vars expect ("h s% l%"). */
export function trackTint(seed: string): Tint {
  const hue = hash(seed) % 360;
  const at = (offset: number) => `${(hue + offset) % 360} 78% 56%`;
  return { a: at(0), b: at(48), c: at(132) };
}
