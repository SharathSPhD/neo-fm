import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  VOICE_CATALOGUE,
  VOICE_IDS,
  findVoice,
  voicesForLanguage,
} from "./voice-catalogue.js";

// __dirname equivalent for Node 20 + ESM. The TS catalogue lives in
// `packages/co-composer/src/`, and the JSON it mirrors lives in
// `services/vocal-synth/app/`. We climb four levels to reach the repo
// root, then descend to the JSON file.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const JSON_PATH = resolve(
  REPO_ROOT,
  "services/vocal-synth/app/voice_catalog.json",
);

interface JsonVoiceRow {
  voice_id: string;
  language: string;
  gender: "male" | "female" | "androgynous";
  persona: string;
  label: string;
  backend: string;
  prompt: string;
  preview_path: string;
}

describe("voice catalogue (TS mirror)", () => {
  it("ships 16 voices in v1.4 Sprint 5", () => {
    expect(VOICE_CATALOGUE).toHaveLength(16);
  });

  it("has lexicographically sorted VOICE_IDS", () => {
    const sorted = VOICE_IDS.slice().sort();
    expect(VOICE_IDS).toEqual(sorted);
  });

  it("has no duplicate voice_ids", () => {
    const set = new Set(VOICE_CATALOGUE.map((v) => v.voice_id));
    expect(set.size).toBe(VOICE_CATALOGUE.length);
  });

  it("findVoice round-trips every entry", () => {
    for (const entry of VOICE_CATALOGUE) {
      expect(findVoice(entry.voice_id)).toBe(entry);
    }
    expect(findVoice("not-a-real-voice")).toBeUndefined();
  });

  it("voicesForLanguage filters by language", () => {
    expect(voicesForLanguage("kn").map((v) => v.voice_id)).toEqual([
      "indic_kn_male_warm",
      "indic_kn_female_bhajan",
    ]);
    expect(voicesForLanguage("ta")).toHaveLength(2);
    expect(voicesForLanguage("sa")).toHaveLength(1);
  });

  it("stays byte-aligned with the Python catalogue", () => {
    const json = JSON.parse(readFileSync(JSON_PATH, "utf8")) as {
      voices: JsonVoiceRow[];
    };
    const tsIds = VOICE_CATALOGUE.map((v) => v.voice_id);
    const pyIds = json.voices.map((v) => v.voice_id);
    expect(tsIds).toEqual(pyIds);
    for (const tsRow of VOICE_CATALOGUE) {
      const pyRow = json.voices.find((v) => v.voice_id === tsRow.voice_id);
      expect(pyRow).toBeDefined();
      expect(pyRow!.language).toBe(tsRow.language);
      expect(pyRow!.gender).toBe(tsRow.gender);
      expect(pyRow!.persona).toBe(tsRow.persona);
      expect(pyRow!.label).toBe(tsRow.label);
      expect(pyRow!.preview_path).toBe(tsRow.preview_path);
    }
  });
});
