/**
 * oEmbed (https://oembed.com) response for a public song. Consumers such
 * as Notion, Substack, Discord-style unfurlers and WordPress call the
 * endpoint advertised in <link rel="alternate" type="application/json+oembed">.
 */
import {
  DEFAULT_EMBED,
  EMBED_HEIGHT,
  clampWidth,
  embedIframeHtml,
  type EmbedOptions,
} from "./options";

export interface OembedResponse {
  version: "1.0";
  type: "rich";
  provider_name: "neo-fm";
  provider_url: string;
  title: string;
  author_name?: string;
  author_url?: string;
  html: string;
  width: number;
  height: number;
  thumbnail_url: string;
  thumbnail_width: number;
  thumbnail_height: number;
  cache_age: number;
}

const DEFAULT_WIDTH = 560;

/** Parses `https://host/s/<publicId>[/embed]` and returns the id, or null for any other URL. */
export function publicIdFromUrl(raw: string, allowedHost?: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (allowedHost && u.host !== allowedHost) return null;
  const m = /^\/s\/([0-9abcdefghjkmnpqrstvwxyz]{10})(?:\/embed)?\/?$/.exec(u.pathname);
  return m ? m[1]! : null;
}

export function buildOembed(args: {
  origin: string;
  publicId: string;
  title: string;
  maxwidth?: number | null;
  maxheight?: number | null;
  options?: EmbedOptions;
}): OembedResponse {
  const options = args.options ?? DEFAULT_EMBED;
  // The consumer's size limits win; the player is responsive so a narrower
  // width is fine, but the height must fit the layout or the player clips.
  const requested = clampWidth(args.maxwidth ?? DEFAULT_WIDTH) ?? DEFAULT_WIDTH;
  const width = Math.min(requested, DEFAULT_WIDTH);
  const natural = EMBED_HEIGHT[options.layout];
  const layout =
    args.maxheight != null && args.maxheight < natural
      ? ({ ...options, layout: "compact" } as EmbedOptions)
      : options;
  const height = EMBED_HEIGHT[layout.layout];
  return {
    version: "1.0",
    type: "rich",
    provider_name: "neo-fm",
    provider_url: args.origin,
    title: args.title,
    html: embedIframeHtml({
      origin: args.origin,
      publicId: args.publicId,
      title: args.title,
      options: layout,
      width,
    }),
    width,
    height,
    thumbnail_url: `${args.origin}/s/${args.publicId}/opengraph-image`,
    thumbnail_width: 1200,
    thumbnail_height: 630,
    cache_age: 3600,
  };
}
