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
    default: {
      const _exhaustive: never = style;
      throw new Error(`Unknown style_family: ${String(_exhaustive)}`);
    }
  }
}
