/**
 * Embed options shared by the player page, the oEmbed endpoint and the
 * share modal's code generator. Keeping the sizes in one place means the
 * snippet we hand out always matches what the player is laid out for.
 */

export type EmbedLayout = "compact" | "full";
export type EmbedTheme = "auto" | "light" | "dark";

export interface EmbedOptions {
  layout: EmbedLayout;
  theme: EmbedTheme;
}

export const DEFAULT_EMBED: EmbedOptions = { layout: "full", theme: "auto" };

/** Iframe heights that fit each layout without an inner scrollbar. */
export const EMBED_HEIGHT: Record<EmbedLayout, number> = {
  compact: 148,
  full: 352,
};

export const EMBED_MIN_WIDTH = 240;
export const EMBED_MAX_WIDTH = 1200;

type Param = string | string[] | undefined;

function first(v: Param): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Unknown or malformed values fall back to the defaults rather than erroring. */
export function parseEmbedOptions(
  params: Record<string, Param> | URLSearchParams,
): EmbedOptions {
  const get = (k: string): string | undefined =>
    params instanceof URLSearchParams
      ? (params.get(k) ?? undefined)
      : first(params[k]);
  const layout = get("layout");
  const theme = get("theme");
  return {
    layout: layout === "compact" ? "compact" : DEFAULT_EMBED.layout,
    theme: theme === "light" || theme === "dark" ? theme : DEFAULT_EMBED.theme,
  };
}

export function embedPath(publicId: string, opts: EmbedOptions): string {
  const q = new URLSearchParams();
  if (opts.layout !== DEFAULT_EMBED.layout) q.set("layout", opts.layout);
  if (opts.theme !== DEFAULT_EMBED.theme) q.set("theme", opts.theme);
  const qs = q.toString();
  return `/s/${publicId}/embed${qs ? `?${qs}` : ""}`;
}

/** Width in px, or null for fluid (100%). Out-of-range widths are clamped. */
export function clampWidth(width: number | null | undefined): number | null {
  if (width == null || !Number.isFinite(width)) return null;
  return Math.min(EMBED_MAX_WIDTH, Math.max(EMBED_MIN_WIDTH, Math.round(width)));
}

export function embedIframeHtml(args: {
  origin: string;
  publicId: string;
  title?: string;
  options: EmbedOptions;
  /** px, or null/undefined for fluid width. */
  width?: number | null;
}): string {
  const w = clampWidth(args.width);
  const title = (args.title ?? "neo-fm song").replace(/[<>"&]/g, "");
  const src = `${args.origin}${embedPath(args.publicId, args.options)}`;
  return `<iframe src="${src}" title="${title}" width="${w ?? "100%"}" height="${EMBED_HEIGHT[args.options.layout]}" style="border:0;border-radius:12px;max-width:100%" loading="lazy" allow="autoplay; encrypted-media"></iframe>`;
}
