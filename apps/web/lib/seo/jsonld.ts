/**
 * schema.org JSON-LD builders for song and collection pages.
 *
 * Only facts the product actually holds go in: title, language, style,
 * duration, publish date, lyrics the page already shows. Audio URLs are
 * signed and expire, so the structured data points at the embeddable
 * player instead of a contentUrl.
 */

const PUBLISHER = { "@type": "Organization", name: "Technektar" } as const;

/** Serialises for a <script type="application/ld+json"> without letting data close the tag. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, (c) => (c === "\u2028" ? "\\u2028" : "\\u2029"));
}

/** Seconds to an ISO 8601 duration, e.g. 192 -> PT3M12S. */
export function isoDuration(seconds: number | null | undefined): string | undefined {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `PT${m ? `${m}M` : ""}${r || !m ? `${r}S` : ""}`;
}

export interface SongLd {
  base: string;
  publicId: string;
  name: string;
  /** BCP 47 language code, e.g. "ta". */
  language: string;
  /** Human-readable style, used as genre. */
  genre?: string;
  durationSeconds?: number | null;
  datePublished?: string | null;
  lyrics?: string | null;
  hasAudio?: boolean;
}

const MAX_LYRICS_CHARS = 5000;

export function musicRecordingLd(s: SongLd) {
  const url = `${s.base}/s/${s.publicId}`;
  const lyrics = s.lyrics?.trim().slice(0, MAX_LYRICS_CHARS);
  return {
    "@context": "https://schema.org",
    "@type": "MusicRecording",
    "@id": `${url}#recording`,
    url,
    name: s.name,
    inLanguage: s.language,
    ...(s.genre ? { genre: s.genre } : {}),
    ...(isoDuration(s.durationSeconds) ? { duration: isoDuration(s.durationSeconds) } : {}),
    ...(s.datePublished ? { datePublished: s.datePublished } : {}),
    ...(s.hasAudio
      ? { audio: { "@type": "AudioObject", name: s.name, embedUrl: `${url}/embed`, inLanguage: s.language } }
      : {}),
    ...(lyrics
      ? { recordingOf: { "@type": "MusicComposition", name: s.name, inLanguage: s.language, lyrics: { "@type": "CreativeWork", inLanguage: s.language, text: lyrics } } }
      : {}),
    publisher: PUBLISHER,
    isAccessibleForFree: true,
    // The audio is generated; say so in the data as well as on the page.
    creditText: "AI-generated with neo-fm",
  };
}

export interface PlaylistTrack {
  publicId: string;
  name: string;
  language: string;
}

export function musicPlaylistLd(args: {
  base: string;
  /** Path of the page itself, e.g. "/ai-songs/tamil". */
  path: string;
  name: string;
  description?: string;
  language?: string;
  tracks: readonly PlaylistTrack[];
}) {
  const url = `${args.base}${args.path}`;
  return {
    "@context": "https://schema.org",
    "@type": "MusicPlaylist",
    "@id": `${url}#playlist`,
    url,
    name: args.name,
    ...(args.description ? { description: args.description } : {}),
    ...(args.language ? { inLanguage: args.language } : {}),
    numTracks: args.tracks.length,
    track: args.tracks.map((t, i) => ({
      "@type": "MusicRecording",
      position: i + 1,
      url: `${args.base}/s/${t.publicId}`,
      name: t.name,
      inLanguage: t.language,
    })),
    publisher: PUBLISHER,
  };
}
