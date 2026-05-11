/**
 * Phase 2 SongDocument -> GenerateRequest translator and the deterministic
 * builder for `demos/phase-2-request.golden.json`.
 *
 * Lives in `src/` (not `scripts/`) so it can be imported by tests for a
 * pure golden parity check without shelling out to a child process.
 */

import { readFileSync } from "node:fs";

import {
  SongDocumentSchema,
  type Section,
  type SongDocument,
} from "@neo-fm/song-doc";

import { WesternCoComposer } from "./western.js";

export const PHASE_2_JOB_ID = "00000000-0000-0000-0000-000000000002";
export const PHASE_2_ATTEMPT_ID = "phase-2-golden-attempt-1";

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

export async function buildPhase2RequestText(
  fixturePath: string,
): Promise<string> {
  const raw = JSON.parse(readFileSync(fixturePath, "utf-8"));
  const doc = SongDocumentSchema.parse(raw);
  const elaborated = await new WesternCoComposer().elaborate(doc);
  const request = songDocToGenerateRequest(
    elaborated,
    PHASE_2_JOB_ID,
    PHASE_2_ATTEMPT_ID,
  );
  return stableStringify(request) + "\n";
}
