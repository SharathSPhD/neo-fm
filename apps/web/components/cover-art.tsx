/**
 * Cover-art primitives shared by Library, Discover, song detail, and the
 * command palette.
 *
 *  - `<CoverArt>`         – renders a signed-URL image with a deterministic
 *                           gradient fallback when no cover row exists yet.
 *  - `coverGradient()`    – pure helper exported so server components can
 *                           inline the same gradient in SSR'd markup
 *                           (avoids the SSR/CSR mismatch flicker that you
 *                           get with `Math.random`-style placeholders).
 *
 * The fallback gradient is keyed off (style_family, id-hash) so the same
 * song always paints the same fallback — important when realtime row
 * updates replace a card and you don't want the placeholder colour to
 * pop.
 *
 * `<CoverArt>` is a server-safe component (no client-only APIs) so it can
 * be rendered from both server and client trees.
 */
import { cn } from "@/lib/cn";

type CoverArtProps = {
  url: string | null;
  /** stable id (job id, public id, etc) used as fallback hash input */
  seed: string;
  styleFamily?: string | null;
  alt: string;
  className?: string;
  /** when true, the gradient placeholder also paints a tiny note glyph */
  showGlyph?: boolean;
};

export function CoverArt({
  url,
  seed,
  styleFamily,
  alt,
  className,
  showGlyph = true,
}: CoverArtProps) {
  const gradient = coverGradient(seed, styleFamily ?? null);
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={cn(
          "h-full w-full object-cover transition-opacity",
          className,
        )}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={alt}
      className={cn(
        "flex h-full w-full items-center justify-center text-3xl text-white/70",
        className,
      )}
      style={{ background: gradient }}
    >
      {showGlyph ? <span aria-hidden>♪</span> : null}
    </div>
  );
}

/**
 * Deterministic linear-gradient CSS string. Same seed → same gradient.
 *
 * The hue palette is biased toward the style family so Carnatic songs land
 * in warm/saffron tones, Hindustani in indigo/teal, Kannada folk in
 * earth/ochre, and Western in cool/slate. Within a family we still
 * spread hues by hash so adjacent songs don't all look identical.
 */
export function coverGradient(
  seed: string,
  styleFamily: string | null,
): string {
  const baseHue = hueForStyle(styleFamily);
  // simple deterministic hash → small offset on top of the base hue
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) & 0xffff;
  }
  const hueA = (baseHue + (h % 28) - 14 + 360) % 360;
  const hueB = (hueA + 35 + ((h >> 8) % 25)) % 360;
  return `linear-gradient(135deg, hsl(${hueA}, 55%, 32%), hsl(${hueB}, 60%, 18%))`;
}

function hueForStyle(styleFamily: string | null): number {
  switch (styleFamily) {
    case "carnatic":
      return 24; // saffron
    case "hindustani":
      return 215; // indigo-teal
    case "kannada-folk":
      return 45; // ochre
    // v1.3 Sprint 2: bhavageete + Tamil folk get their own hues so
    // gallery cards visually distinguish them from generic folk.
    case "kannada-light-classical":
      return 320; // magenta-rose (sugama lyric)
    case "tamil-folk":
      return 8; // warm vermillion (parai energy)
    case "western":
      return 210; // slate-blue
    default:
      return 280; // neutral aubergine
  }
}
