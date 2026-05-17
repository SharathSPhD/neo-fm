/**
 * Pure helpers that the variation and remix API routes share to apply
 * a `ForkSongBody` to a parent SongDocument before handing it to
 * `create_song_job`. Kept in its own module so the heavy zod-validated
 * route handlers stay readable, and so unit tests can drive the
 * mutation logic without spinning up Supabase.
 *
 * Conventions:
 *   - `tempo_bpm`, `key_override`, `raga_override`, `voice_id`,
 *     `title`, and `section_ids` are advisory. The applier never
 *     mutates a field whose override is missing.
 *   - `key_override` is only meaningful for `style_family === "western"`.
 *     For other styles we drop it on the floor; the dialog warns
 *     the user client-side.
 *   - `raga_override` requires the parent style to be in the per-style
 *     raga allow-list. If the override is incompatible we return a
 *     typed error rather than silently dropping the value — letting
 *     the route emit a 422 to the dialog so the user can correct.
 *   - `section_ids` is *passed through* as part of `metadata.fork`:
 *     the dgx-worker is responsible for the actual partial-regen.
 *     This sprint just lands the contract.
 */

import type {
  ForkRagaOverride,
  ForkSongBody,
} from "./fork";

export const STYLE_RAGA_ALLOWLIST: Record<
  string,
  ReadonlySet<ForkRagaOverride["system"]> | null
> = {
  western: null,
  "bollywood-ballad": null,
  carnatic: new Set(["carnatic"]),
  hindustani: new Set(["hindustani"]),
  "kannada-light-classical": new Set(["light-classical", "carnatic"]),
  "kannada-folk": new Set(["folk"]),
  "tamil-folk": new Set(["folk"]),
  "bengali-rabindrasangeet": new Set(["hindustani", "light-classical"]),
  "telugu-keerthana": new Set(["carnatic"]),
  "sanskrit-shloka": new Set(["carnatic"]),
};

export interface ParentDocLike {
  style_family: string;
  title?: string;
  tempo_bpm?: number;
  target_duration_seconds?: number;
  raga?: { name: string; system: string };
  metadata?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface ApplyForkOptions {
  /** "variation" or "remix"; controls the `metadata.fork.kind` tag. */
  kind: "variation" | "remix";
  /**
   * If true, append " (remix)" to the title when the body did not
   * specify an explicit title. Variations never auto-suffix; that
   * stays a remix-only affordance.
   */
  appendRemixSuffix: boolean;
  /** Distance to fall back to when the body omits it. */
  defaultDistance: number;
}

export type ApplyForkOk = {
  ok: true;
  doc: ParentDocLike;
};

export type ApplyForkErr = {
  ok: false;
  error: "raga_incompatible_with_style" | "key_override_not_western";
  message: string;
};

export type ApplyForkResult = ApplyForkOk | ApplyForkErr;

export function applyForkToDoc(
  parent: ParentDocLike,
  body: ForkSongBody,
  opts: ApplyForkOptions,
): ApplyForkResult {
  // Deep clone so the caller can hand the result straight to RPC
  // without worrying about aliasing.
  const next: ParentDocLike = JSON.parse(JSON.stringify(parent));

  // ----- Title --------------------------------------------------------
  if (body.title !== undefined && body.title.length > 0) {
    next.title = body.title.slice(0, 120);
  } else if (
    opts.appendRemixSuffix &&
    typeof next.title === "string" &&
    !next.title.endsWith("(remix)")
  ) {
    next.title = `${next.title} (remix)`.slice(0, 120);
  }

  // ----- Tempo --------------------------------------------------------
  if (body.tempo_bpm !== undefined) {
    next.tempo_bpm = body.tempo_bpm;
  } else if (opts.kind === "remix" && typeof next.tempo_bpm === "number") {
    // Keep the v1.3 ±15 BPM jitter for "blind remixes" (no explicit
    // tempo override). Sprint 16's reranker will own this once it
    // ships; for now keep the audible-but-recognisable behaviour.
    const delta = Math.floor(Math.random() * 31) - 15;
    const next_bpm = next.tempo_bpm + (delta === 0 ? 5 : delta);
    next.tempo_bpm = Math.max(30, Math.min(240, next_bpm));
  }

  // ----- Key (Western-only) ------------------------------------------
  if (body.key_override !== undefined) {
    if (next.style_family !== "western") {
      return {
        ok: false,
        error: "key_override_not_western",
        message: `key_override is only meaningful for style_family="western"; parent is "${next.style_family}".`,
      };
    }
    const meta = (next.metadata ?? {}) as Record<string, unknown>;
    meta.key = body.key_override;
    next.metadata = meta;
  }

  // ----- Raga override -----------------------------------------------
  if (body.raga_override !== undefined) {
    const allow = STYLE_RAGA_ALLOWLIST[next.style_family];
    if (allow === null || allow === undefined) {
      return {
        ok: false,
        error: "raga_incompatible_with_style",
        message: `style_family "${next.style_family}" does not accept a raga.`,
      };
    }
    if (!allow.has(body.raga_override.system)) {
      return {
        ok: false,
        error: "raga_incompatible_with_style",
        message: `raga.system "${body.raga_override.system}" is not permitted for style_family "${next.style_family}".`,
      };
    }
    next.raga = {
      name: body.raga_override.name,
      system: body.raga_override.system,
    };
  }

  // ----- Voice id (opaque, worker resolves) --------------------------
  if (body.voice_id !== undefined) {
    next.voice_id = body.voice_id;
  }

  // ----- Distance + section_ids: stamped into metadata.fork ---------
  // The dgx-worker reads this to drive sampler temperature / partial
  // regen. Stash both in a single namespaced slot so producers downstream
  // don't have to mine multiple keys.
  const meta = (next.metadata ?? {}) as Record<string, unknown>;
  const forkMeta = {
    kind: opts.kind,
    distance: body.distance ?? opts.defaultDistance,
    ...(body.section_ids && body.section_ids.length > 0
      ? { section_ids: body.section_ids }
      : {}),
  };
  meta.fork = forkMeta;
  next.metadata = meta;

  return { ok: true, doc: next };
}
