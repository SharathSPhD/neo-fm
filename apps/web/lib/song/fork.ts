/**
 * v1.4 Sprint 3: shared shape for "Make a variation" + "Make a remix"
 * dialogs. Both /api/songs/[id]/variation and /api/songs/[id]/remix
 * accept the same body, but the *semantics* of `distance` differ:
 *
 *  - Variation: `distance` defaults to ~25 — same composition, fresh
 *    render. The worker re-uses the parent SongDocument verbatim
 *    unless the user has overridden an explicit field (tempo, key,
 *    raga, voice, sections). The dialog leans on the model's natural
 *    stochasticity.
 *
 *  - Remix: `distance` defaults to ~65 — meaningful creative pivot.
 *    Even with no per-field overrides, the server applies a ±15-BPM
 *    tempo jitter (kept from the v1.3 behaviour) and the suffix
 *    "(remix)" is appended to the title for lineage clarity.
 *
 * The Zod body is intentionally permissive (every field optional) so
 * the older empty-POST callers (the Sprint 2 buttons, prod-smoke)
 * keep working. Server-side validation happens against the parent's
 * style_family — e.g. `key_override` is only honoured for `western`.
 */

import { z } from "zod";

// Mirror of the Zod source-of-truth in @neo-fm/song-doc. Duplicated
// here as a string union so this module stays usable from the Edge
// runtime without pulling in `zod-to-json-schema`.
export const FORK_RAGA_SYSTEM_VALUES = [
  "carnatic",
  "hindustani",
  "light-classical",
  "folk",
] as const;
export type ForkRagaSystem = (typeof FORK_RAGA_SYSTEM_VALUES)[number];

export const FORK_SECTION_SELECTION_MAX = 32;

export const ForkRagaOverrideSchema = z.object({
  name: z.string().trim().min(1).max(64),
  system: z.enum(FORK_RAGA_SYSTEM_VALUES),
});
export type ForkRagaOverride = z.infer<typeof ForkRagaOverrideSchema>;

export const ForkSongBodySchema = z
  .object({
    /**
     * 0 ("more same") .. 100 ("more different"). Forwarded to the
     * worker as `metadata.fork_distance`. The music-inference layer
     * maps it to temperature / cfg_scale internally — see ADR 0023.
     */
    distance: z.number().int().min(0).max(100).optional(),
    /** Free-form override of the parent's tempo. Clamped to 30..240. */
    tempo_bpm: z.number().int().min(30).max(240).optional(),
    /** Western-only key override (e.g. "C", "F#m"). Capped at 8 chars. */
    key_override: z.string().trim().min(1).max(8).optional(),
    /** Per-fork raga override. Server validates against style_family. */
    raga_override: ForkRagaOverrideSchema.optional(),
    /**
     * Voice catalog ID (opaque; matches the keys in voice_catalog.json
     * shipped by Sprint 5). The worker is responsible for resolving
     * it to a concrete vocal-synth backend route.
     */
    voice_id: z.string().trim().min(1).max(64).optional(),
    /**
     * Subset of section ids to regenerate. An empty array or a missing
     * field means "all sections". Capped so a single request cannot
     * blow past the 4000-char total-lyrics budget.
     */
    section_ids: z
      .array(z.string().trim().min(1).max(64))
      .max(FORK_SECTION_SELECTION_MAX)
      .optional(),
    /** Optional title override. Trimmed; the route applies the cap. */
    title: z.string().trim().max(120).optional(),
  })
  .strict();
export type ForkSongBody = z.infer<typeof ForkSongBodySchema>;

export const DEFAULT_VARIATION_DISTANCE = 25;
export const DEFAULT_REMIX_DISTANCE = 65;

/**
 * Coerces an incoming JSON body into a typed `ForkSongBody`. Treats
 * an empty body / null / undefined as the empty object so the old
 * "POST with no body" call sites keep working.
 */
export function parseForkBody(raw: unknown): ForkSongBody {
  if (raw === null || raw === undefined || raw === "") return {};
  if (typeof raw === "object" && Object.keys(raw as object).length === 0) {
    return {};
  }
  return ForkSongBodySchema.parse(raw);
}
