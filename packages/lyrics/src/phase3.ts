/**
 * Phase 3 golden pipeline: PublicLyricsLibraryProvider -> SongDocument ->
 * GenerateRequest payload for music-inference /v1/generate.
 *
 * Mirrors `co-composer/src/phase2.ts` so both phase golden builders use the
 * same translator shape. Co-composer is intentionally *not* run here:
 * Phase 3 demonstrates the lyrics-to-document seam alone, and the Hindustani
 * co-composer doesn't land until later. The generate request therefore
 * carries no synthesis tags — music-inference will treat the document as
 * unstyled and apply defaults, which is exactly what we want as a baseline.
 */

import type { Section, SongDocument } from "@neo-fm/song-doc";

import { PublicLyricsLibraryProvider } from "./provider.js";

export const PHASE_3_JOB_ID = "00000000-0000-0000-0000-000000000003";
export const PHASE_3_ATTEMPT_ID = "phase-3-golden-attempt-1";

export interface GenerateRequestSection {
  id: string;
  type: string;
  lyrics?: string;
  language?: string;
  script?: string;
  transliteration?: string;
  swara_sequence?: string;
  phonemes?: string[];
  target_seconds: number;
  tags?: string[];
}

export interface GenerateRequest {
  job_id: string;
  attempt_id: string;
  style_family: string;
  tempo_bpm?: number;
  time_signature?: string;
  tala?: string;
  target_duration_seconds: number;
  sections: GenerateRequestSection[];
  output_format: "wav";
  sample_rate: 48000;
}

export function songDocToGenerateRequest(
  doc: SongDocument,
  job_id: string,
  attempt_id: string,
): GenerateRequest {
  const toSection = (s: Section): GenerateRequestSection => ({
    id: s.id,
    type: s.type,
    ...(s.lyrics !== undefined && { lyrics: s.lyrics }),
    ...(doc.language !== undefined && { language: doc.language }),
    ...(s.script !== undefined && { script: s.script }),
    ...(s.transliteration !== undefined && {
      transliteration: s.transliteration,
    }),
    ...(s.swara_sequence !== undefined && { swara_sequence: s.swara_sequence }),
    ...(s.phonemes !== undefined && { phonemes: s.phonemes }),
    target_seconds: s.target_seconds,
    ...(s.tags !== undefined && { tags: s.tags }),
  });

  return {
    job_id,
    attempt_id,
    style_family: doc.style_family,
    ...(doc.tempo_bpm !== undefined && { tempo_bpm: doc.tempo_bpm }),
    ...(doc.time_signature !== undefined && {
      time_signature: doc.time_signature,
    }),
    ...(doc.tala !== undefined && { tala: doc.tala }),
    target_duration_seconds: doc.target_duration_seconds,
    sections: doc.sections.map(toSection),
    output_format: "wav",
    sample_rate: 48000,
  };
}

export function stableStringify(value: unknown, indent = 2, depth = 0): string {
  const pad = " ".repeat(indent * depth);
  const innerPad = " ".repeat(indent * (depth + 1));
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value
      .map((v) => `${innerPad}${stableStringify(v, indent, depth + 1)}`)
      .join(",\n");
    return `[\n${items}\n${pad}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  if (keys.length === 0) return "{}";
  const entries = keys
    .map(
      (k) =>
        `${innerPad}${JSON.stringify(k)}: ${stableStringify(
          obj[k],
          indent,
          depth + 1,
        )}`,
    )
    .join(",\n");
  return `{\n${entries}\n${pad}}`;
}

export interface BuildPhase3Options {
  rootDir?: string;
}

export async function buildPhase3RequestText(
  options: BuildPhase3Options = {},
): Promise<string> {
  const provider = new PublicLyricsLibraryProvider({ rootDir: options.rootDir });
  const doc = await provider.generate({
    language: "hi",
    style_family: "hindustani",
    reference_lyrics: "kabir-pothi",
    target_duration_seconds: 60,
  });
  const request = songDocToGenerateRequest(
    doc,
    PHASE_3_JOB_ID,
    PHASE_3_ATTEMPT_ID,
  );
  return stableStringify(request) + "\n";
}
