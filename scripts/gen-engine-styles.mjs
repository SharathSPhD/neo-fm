#!/usr/bin/env node
// Trims strategy/indian-music-styles.json to the fields the engine uses and writes apps/web/lib/engine/styles.json.
// Native-script Lyria hints are dropped on purpose: they are machine-written and wait for a native read.
// Usage: node scripts/gen-engine-styles.mjs /mnt/project-files/strategy/indian-music-styles.json
import { readFileSync, writeFileSync } from "node:fs";

const src = JSON.parse(readFileSync(process.argv[2] ?? "indian-music-styles.json", "utf8"));
const pick = (s) => ({
  id: s.id, name: s.name, tradition: s.tradition, languages: s.languages, lyric_form: s.lyric_form, metre: s.metre,
  instruments: s.instruments, lyria_hint_en: s.lyria_hint_en, lyria_vocal: s.lyria_vocal, pce_sections: s.pce_sections,
  must_avoid: s.must_avoid, sensitivity: s.sensitivity, launch_priority: s.launch_priority, dayparts: s.dayparts, moods: s.moods,
});
const out = {
  version: src.version,
  styles: src.styles.map(pick),
  festivals: src.festivals.map((f) => ({ festival: f.festival, styles: f.styles, themes: f.themes })),
  routing: { keyword_map: src.routing.keyword_map, by_language: src.routing.by_language, daypart_defaults: src.routing.daypart_defaults },
};
writeFileSync(new URL("../apps/web/lib/engine/styles.json", import.meta.url), JSON.stringify(out) + "\n");
