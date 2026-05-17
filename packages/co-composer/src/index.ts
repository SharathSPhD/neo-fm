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
 * - Phase 10+ may replace the hand-rolled mappings with Pratyabhijna while
 *   keeping the same SongDocument-in, SongDocument-out interface. (Pratyabhijna
 *   is intentionally out of v1 scope; the hand-rolled mappings are the v1
 *   shipping path.)
 */
export interface CoComposer {
  readonly style_family: StyleFamily;
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
  switch (style) {
    case "western":
      return new WesternCoComposer();
    case "carnatic":
      return new CarnaticCoComposer();
    case "hindustani":
      return new HindustaniCoComposer();
    case "kannada-folk":
      return new KannadaFolkCoComposer();
    case "kannada-light-classical":
      return new KannadaLightClassicalCoComposer();
    case "tamil-folk":
      return new TamilFolkCoComposer();
    // v1.4 Sprint 2: new style families. Until their dedicated
    // co-composers ship (Sprint 8 / Sprint 14 / Sprint 15), route to
    // the closest existing composer so the worker can still elaborate
    // a SongDocument end-to-end. The override is a temporary delegation
    // -- the routing is exhaustively typed so as soon as a new
    // co-composer lands we can flip the corresponding case here.
    case "bollywood-ballad":
      // Pop-rock harmony with Indian instrument tags. The Western
      // composer's chord progression is the closest existing fit; the
      // music-inference tag set adds the Bollywood + harmonium tags.
      return new WesternCoComposer();
    case "bengali-rabindrasangeet":
      // Tagore's songs catalogue under Hindustani ragas; the
      // Hindustani composer's modal contour is the closest match
      // until the Sprint 15 rabindra-sangeet composer lands.
      return new HindustaniCoComposer();
    case "telugu-keerthana":
      // Tyagaraja-style keerthana follows the Carnatic kriti shape.
      return new CarnaticCoComposer();
    case "sanskrit-shloka":
      // Vedic chant is closer to Carnatic alaap than to any folk
      // template. Sprint 14 lands a dedicated chant composer.
      return new CarnaticCoComposer();
    default: {
      const _exhaustive: never = style;
      throw new Error(`Unknown style_family: ${String(_exhaustive)}`);
    }
  }
}
