/**
 * Shared phoneme-emission helper for the co-composers.
 *
 * v1.3 Sprint 4. Each co-composer that owns at least one Indic
 * language (everyone except Western) calls `attachPhonemes(doc)` at
 * the end of `elaborate()` so the worker forwards a canonical
 * pronunciation stream into the `/v1/vocalize` payload. The router
 * inside `services/vocal-synth` then feeds the phonemes into
 * whichever backend handles the section.
 *
 * Why centralise it:
 *   - Every co-composer would otherwise duplicate the same "is this
 *     a section with lyrics in a language we know how to phonemize"
 *     check, and the duplication would rot the moment we tweak the
 *     rule pack.
 *   - The Western co-composer also opts in for `language=hi|kn|ta`
 *     so a Hinglish pop track still gets phonemes — see the call
 *     site in `western.ts`.
 *
 * Backwards-compat: existing producer-supplied `section.phonemes`
 * survives untouched. We never overwrite — the producer has earned
 * their say.
 */

import {
  type Language as G2PLanguage,
  type Script as G2PScript,
  phonemesForSection,
} from "@neo-fm/g2p";
import type { Section, SongDocument } from "@neo-fm/song-doc";

// English routing is intentionally excluded here. The English-path in
// `@neo-fm/g2p` falls through to a Roman passthrough, which would
// re-emit lowercased words as "phonemes" -- useful for nothing and
// noisy in the worker payload. Producers who want phonemes for a
// Hinglish track set `language: "hi"` on the Song Document; only then
// do we attach phonemes (via the Hindi Latin-script rule pack).
const G2P_SUPPORTED: ReadonlySet<G2PLanguage> = new Set(["hi", "kn", "ta"]);

function asG2PLanguage(lang: string): G2PLanguage | null {
  return (G2P_SUPPORTED as Set<string>).has(lang) ? (lang as G2PLanguage) : null;
}

function asG2PScript(script: string | undefined): G2PScript | undefined {
  if (!script) return undefined;
  switch (script) {
    case "latin":
    case "devanagari":
    case "kannada":
    case "tamil":
    case "telugu":
    case "bengali":
      return script;
    default:
      return undefined;
  }
}

/** Returns the section with `phonemes` filled in, or unchanged if N/A. */
export function withPhonemes(
  section: Section,
  language: string,
): Section {
  if (section.phonemes !== undefined) return section; // producer veto
  const g2pLang = asG2PLanguage(language);
  if (g2pLang === null) return section;
  if (!section.lyrics && !section.transliteration) return section;
  const phonemes = phonemesForSection({
    language: g2pLang,
    lyrics: section.lyrics,
    transliteration: section.transliteration,
    script: asG2PScript(section.script),
  });
  if (phonemes.length === 0) return section;
  return { ...section, phonemes };
}

/** Apply `withPhonemes` to every section. Pure. */
export function attachPhonemes(doc: SongDocument): SongDocument {
  return {
    ...doc,
    sections: doc.sections.map((s) => withPhonemes(s, doc.language)),
  };
}
