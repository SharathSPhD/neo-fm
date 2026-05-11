import type { SongDocument, StyleFamily } from "@neo-fm/song-doc";
import { NotYetIntegratedError } from "@neo-fm/song-doc";

import { WesternCoComposer } from "./western.js";

/**
 * A CoComposer takes a partial Song Document (typically lyrics + section types
 * + style) and returns a fully-elaborated Song Document with melody, harmony,
 * rhythm and orchestration filled in.
 *
 * - Phase 2 lands the western co-composer.
 * - Phase 6 lands carnatic, hindustani, and kannada-folk co-composers.
 * - Phase 10+ replaces the hand-rolled mappings with Pratyabhijna while
 *   keeping the same SongDocument-in, SongDocument-out interface.
 */
export interface CoComposer {
  readonly style_family: StyleFamily;
  elaborate(doc: SongDocument): Promise<SongDocument>;
}

export { WesternCoComposer };

export class CarnaticCoComposer implements CoComposer {
  readonly style_family: StyleFamily = "carnatic";
  async elaborate(_doc: SongDocument): Promise<SongDocument> {
    throw new NotYetIntegratedError("CarnaticCoComposer", 6);
  }
}

export class HindustaniCoComposer implements CoComposer {
  readonly style_family: StyleFamily = "hindustani";
  async elaborate(_doc: SongDocument): Promise<SongDocument> {
    throw new NotYetIntegratedError("HindustaniCoComposer", 6);
  }
}

export class KannadaFolkCoComposer implements CoComposer {
  readonly style_family: StyleFamily = "kannada-folk";
  async elaborate(_doc: SongDocument): Promise<SongDocument> {
    throw new NotYetIntegratedError("KannadaFolkCoComposer", 6);
  }
}

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
    default: {
      const _exhaustive: never = style;
      throw new Error(`Unknown style_family: ${String(_exhaustive)}`);
    }
  }
}
