/**
 * `PublicLyricsLibraryProvider` — Phase 3.
 *
 * Reads the public-domain corpus from disk, picks a matching entry, and
 * returns a validated `SongDocument` scaffold. The choice of entry is
 * deterministic so the Phase 3 demo and CI parity tests are reproducible:
 *
 *   - If `request.reference_lyrics` matches an entry id (`<lang>/<file>`) or a
 *     significant substring of an entry's title, that entry wins.
 *   - Otherwise the first alphabetically-sorted entry in the requested
 *     language wins.
 *
 * `PratyabhijnaProvider` continues to throw — it lives behind the feature
 * flag and lands properly in Phase 10. We keep the class here so cloud
 * routing code can wire it without referencing an unimplemented module.
 */

import {
  SongDocumentSchema,
  NotYetIntegratedError,
  allocateSectionDurations,
  type Duration,
  type Language,
  type SongDocument,
  type StyleFamily,
} from "@neo-fm/song-doc";

import { loadCorpus, type LoadCorpusOptions, type LyricsEntry } from "./corpus.js";
import { mapToSections } from "./section-mapper.js";

export interface LyricsRequest {
  language: Language;
  style_family: StyleFamily;
  prompt?: string;
  reference_lyrics?: string;
  target_duration_seconds: Duration;
}

export interface LyricsProvider {
  readonly id: string;
  generate(request: LyricsRequest): Promise<SongDocument>;
}

export interface PublicLyricsLibraryProviderOptions {
  /** Filesystem path to `data/public-lyrics/`. Useful for tests. */
  rootDir?: string;
}

const STYLE_LANGUAGE_ALLOWED: Record<StyleFamily, ReadonlySet<Language>> = {
  western: new Set<Language>(["en"]),
  carnatic: new Set<Language>(["kn"]),
  hindustani: new Set<Language>(["hi"]),
  "kannada-folk": new Set<Language>(["kn"]),
};

function findEntry(entries: LyricsEntry[], hint?: string): LyricsEntry {
  if (hint) {
    const normalisedHint = hint.toLowerCase();
    // 1. exact id match
    const byId = entries.find((e) => e.id.toLowerCase() === normalisedHint);
    if (byId) return byId;
    // 2. id ends with `<file>` (allow "tyger" -> "en/blake-tyger")
    const bySuffix = entries.find((e) =>
      e.id.toLowerCase().endsWith(`/${normalisedHint}`),
    );
    if (bySuffix) return bySuffix;
    // 3. title substring (case-insensitive)
    const byTitle = entries.find((e) =>
      e.title.toLowerCase().includes(normalisedHint),
    );
    if (byTitle) return byTitle;
  }
  // Deterministic fallback: first alphabetical entry. `loadCorpus` already
  // sorts.
  return entries[0]!;
}

export class PublicLyricsLibraryProvider implements LyricsProvider {
  readonly id = "public-library";
  private readonly corpusOpts: LoadCorpusOptions;

  constructor(options: PublicLyricsLibraryProviderOptions = {}) {
    this.corpusOpts = { rootDir: options.rootDir };
  }

  async generate(request: LyricsRequest): Promise<SongDocument> {
    const allowedLangs = STYLE_LANGUAGE_ALLOWED[request.style_family];
    if (!allowedLangs.has(request.language)) {
      throw new Error(
        `PublicLyricsLibraryProvider: language=${request.language} is not ` +
          `paired with style_family=${request.style_family}. Allowed for ` +
          `${request.style_family}: ${[...allowedLangs].join(", ")}.`,
      );
    }

    const entries = loadCorpus(request.language, this.corpusOpts);
    const entry = findEntry(entries, request.reference_lyrics ?? request.prompt);

    const sectionDrafts = mapToSections({
      body: entry.body,
      style_family: request.style_family,
      script: entry.script,
    });

    const scaffold = {
      language: request.language,
      style_family: request.style_family,
      target_duration_seconds: request.target_duration_seconds,
      sections: sectionDrafts,
      metadata: {
        // Provider-attribution lives under a namespace so a downstream
        // co-composer / producer cannot accidentally clobber it.
        neo_fm_lyrics_provider: {
          provider_id: this.id,
          entry_id: entry.id,
          entry_title: entry.title,
          entry_author: entry.author,
          entry_source_url: entry.source_url,
          entry_source_citation: entry.source_citation,
          entry_license: entry.license_assertion,
        },
      },
    };

    const allocated = allocateSectionDurations(scaffold);
    // Always go through schema.parse so a malformed corpus (e.g. an empty
    // body, an unrecognised script) becomes a clear error here instead of
    // arriving at the music-inference worker.
    return SongDocumentSchema.parse(allocated);
  }
}

/**
 * Pratyabhijna integration lands in Phase 10. Calling this earlier is a
 * deliberate runtime error so we never ship a silently-mocked creative
 * engine. The seam is kept so the cloud router doesn't have a hard branch
 * on phase-presence — it just instantiates the provider, the provider
 * throws, and the cloud reports a friendly "not yet integrated" error.
 */
export class PratyabhijnaProvider implements LyricsProvider {
  readonly id = "pratyabhijna";
  async generate(_request: LyricsRequest): Promise<SongDocument> {
    throw new NotYetIntegratedError("PratyabhijnaProvider", 10);
  }
}
