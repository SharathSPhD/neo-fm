import type { Language, SongDocument, StyleFamily } from "@neo-fm/song-doc";
import { NotYetIntegratedError } from "@neo-fm/song-doc";

export interface LyricsRequest {
  language: Language;
  style_family: StyleFamily;
  prompt?: string;
  reference_lyrics?: string;
  target_duration_seconds: 30 | 60 | 90 | 180;
}

/**
 * A LyricsProvider turns a user intent (prompt and/or seed lyrics) into a
 * Song Document scaffold (lyrics + section types + initial metre hints).
 *
 * Real implementations land in Phase 3 (public library) and Phase 10 (Pratyabhijna).
 */
export interface LyricsProvider {
  readonly id: string;
  generate(request: LyricsRequest): Promise<SongDocument>;
}

/**
 * Reads from data/public-lyrics/ (Phase 3). Stubbed in Phase 0.
 */
export class PublicLyricsLibraryProvider implements LyricsProvider {
  readonly id = "public-library";
  async generate(_request: LyricsRequest): Promise<SongDocument> {
    throw new NotYetIntegratedError("PublicLyricsLibraryProvider", 3);
  }
}

/**
 * Real Pratyabhijna integration lands in Phase 10.
 * Calling this in earlier phases is a deliberate runtime error so we never ship
 * a silently-mocked creative engine.
 */
export class PratyabhijnaProvider implements LyricsProvider {
  readonly id = "pratyabhijna";
  async generate(_request: LyricsRequest): Promise<SongDocument> {
    throw new NotYetIntegratedError("PratyabhijnaProvider", 10);
  }
}
