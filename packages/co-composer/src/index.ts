import type { SongDocument, StyleFamily } from "@neo-fm/song-doc";

import { CarnaticCoComposer } from "./carnatic.js";
import { HindustaniCoComposer } from "./hindustani.js";
import { KannadaFolkCoComposer } from "./kannada-folk.js";
import { KannadaLightClassicalCoComposer } from "./kannada-light-classical.js";
import { TamilFolkCoComposer } from "./tamil-folk.js";
import { WesternCoComposer } from "./western.js";

/**
 * A CoComposer takes a partial Song Document (typically lyrics + section types
 * + style) and returns a fully-elaborated Song Document with melody, harmony,
 * rhythm and orchestration filled in.
 *
 * - Phase 2 landed the western co-composer.
 * - Phase 6 lands carnatic, hindustani, and kannada-folk.
 * - v1.3 Sprint 2 splits the misclassified Kannada light-classical
 *   (bhavageete) and Tamil-folk presets out of `kannada-folk` into
 *   their own families with dedicated co-composers.
 * - v1.4 widens four new families (sanskrit-shloka, telugu-keerthana,
 *   bengali-rabindrasangeet, bollywood-ballad) which delegate to an
 *   existing composer's musical conventions while preserving their own
 *   `doc.style_family` so downstream worker / vocal-synth / discover
 *   routing sees the user-facing family. Each composer declares the
 *   delegated families it accepts via `acceptedStyleFamilies`.
 * - Phase 10+ may replace the hand-rolled mappings with Pratyabhijna while
 *   keeping the same SongDocument-in, SongDocument-out interface. (Pratyabhijna
 *   is intentionally out of v1 scope; the hand-rolled mappings are the v1
 *   shipping path.)
 */
export interface CoComposer {
  /**
   * Primary / native style family for this composer. Used for telemetry
   * and `metadata.neo_fm_co_composer.name`; not used as the dispatch
   * guard (use `acceptedStyleFamilies` for that).
   */
  readonly style_family: StyleFamily;
  /**
   * Every `style_family` value this composer is willing to elaborate.
   * Includes the primary family and any delegated families. `elaborate()`
   * throws when invoked with a `doc.style_family` outside this set.
   */
  readonly acceptedStyleFamilies: ReadonlySet<StyleFamily>;
  elaborate(doc: SongDocument): Promise<SongDocument>;
}

export {
  CarnaticCoComposer,
  HindustaniCoComposer,
  KannadaFolkCoComposer,
  KannadaLightClassicalCoComposer,
  TamilFolkCoComposer,
  WesternCoComposer,
};

// v1.4 Sprint 4: raga / tala / instrument catalogue surfaced by the
// creation canvas's Advanced disclosure and consumed by the worker
// when the user opts into structured overrides.
export * from "./raga-catalogue.js";

// v1.4 Sprint 5: 16-persona voice catalogue mirrored from
// `services/vocal-synth/app/voice_catalog.json`. Consumed by the
// voice picker on the creation canvas. Keep this re-export below
// `raga-catalogue` so downstream barrel-imports don't reorder
// alphabetically (the lint rule is `simple-import-sort` insertion-
// order tolerant, but humans aren't).
export * from "./voice-catalogue.js";

export function getCoComposer(style: StyleFamily): CoComposer {
  let composer: CoComposer;
  switch (style) {
    case "western":
    case "bollywood-ballad":
      // Western harmony + ballad-pop instrumentation. Composer tags
      // `style:${doc.style_family}`, so a `bollywood-ballad` doc is
      // tagged distinctly from a `western` doc and music-inference /
      // stem planner can route on the user-facing family.
      composer = new WesternCoComposer();
      break;
    case "carnatic":
    case "telugu-keerthana":
    case "sanskrit-shloka":
      // Carnatic raga + kriti/alaap section conventions. Telugu
      // keerthana follows the Tyagaraja kriti shape; sanskrit shloka
      // is closer to Carnatic alaap than any folk template. Composer
      // sets `raga.system: "carnatic"` which the song-doc schema
      // allows for all three (see STYLE_RAGA_ALLOWLIST).
      composer = new CarnaticCoComposer();
      break;
    case "hindustani":
    case "bengali-rabindrasangeet":
      // Hindustani raga + tala. Tagore's songs catalogue under
      // Hindustani ragas; composer's modal contour matches.
      composer = new HindustaniCoComposer();
      break;
    case "kannada-folk":
      composer = new KannadaFolkCoComposer();
      break;
    case "kannada-light-classical":
      composer = new KannadaLightClassicalCoComposer();
      break;
    case "tamil-folk":
      composer = new TamilFolkCoComposer();
      break;
    default: {
      const _exhaustive: never = style;
      throw new Error(`Unknown style_family: ${String(_exhaustive)}`);
    }
  }
  // Dev-only assertion: the dispatcher mapping above must match each
  // composer's `acceptedStyleFamilies`. Catches future drift -- adding
  // a new style to the dispatcher without updating the composer's
  // accepted set (or vice versa) fails loudly in dev / CI / tests
  // rather than at the runtime guard inside elaborate().
  if (!composer.acceptedStyleFamilies.has(style)) {
    throw new Error(
      `getCoComposer(${style}) returned ${composer.style_family} composer ` +
        `but its acceptedStyleFamilies set does not include "${style}". ` +
        `Update the composer's acceptedStyleFamilies or the dispatcher mapping.`,
    );
  }
  return composer;
}
