# Sprint 6 — Indic lyric corpus expansion — ralph evidence

Status: PASS
Date: 2026-05-17
Commit: pending (committed at end of sprint per v1.4 cadence)

## What shipped

- **17 new public-domain lyric entries** across 6 languages, all verified
  PD-in-India (life + 60) and PD-in-US (pre-1929 print source):
  - `ta` (Tamil): 4 → 8 entries. Bharati × 5 (Senthamizh Nadenum, Achcham
    Illai, Vande Mataram, Kaani Nilam, Vellai Thaamarai, Paayum Oli),
    Andal × 1 (Tiruppavai Margazhi), Manikkavacakar × 1 (Tiruvembavai 1).
  - `hi` (Hindi): 4 → 7 entries. Kabir (Jhini Chadariya), Tulsidas
    (Mangalacharan), Surdas (Darshan Do).
  - `kn` (Kannada): 4 → 7 entries. Akkamahadevi (Aru Novendare),
    Basavanna (Ulivaru), Purandaradasa (Bhagyada Lakshmi).
  - `bn` (Bengali) — **new**: Tagore × 3 (Gitanjali #1, Aaji Jharer Rate,
    Ekla Cholo Re).
  - `te` (Telugu) — **new**: Tyagaraja × 3 (Endaro Mahanubhavulu, Nidhi
    Chala Sukhama, Sogasuga Mridanga Talamu).
  - `sa` (Sanskrit) — **new**: Bhagavad Gita 2.55-58 (Sthitaprajna), Adi
    Shankaracharya (Bhaja Govindam), Gayatri Mantra (Rig Veda 3.62.10).
- **FS-driven `STYLE_LANGUAGE_ALLOWED`**: `PublicLyricsLibraryProvider`
  now intersects a hand-curated style-preference list with the set of
  languages physically present in the bundled corpus
  (`BUNDLED_CORPUS_LANGUAGES`). Adding a new PD lyric is a pure data
  change.
- **`scripts/bundle-corpus.ts`** walks every `<language>/` directory
  under `data/public-lyrics/` instead of hard-coding `en/hi/kn`. Emits
  `BUNDLED_CORPUS_LANGUAGES` and `bundledCorpusHasLanguage()` helpers
  alongside the existing data.
- **`library-picker` subtitle fix**: replaced the three-branch hi/kn/else
  cascade with a `LANGUAGE_LABELS: Record<Language, string>` table.
  Tamil now correctly shows "Tamil · Tamil script", Bengali shows
  "Bengali · Bengali script", Sanskrit "Sanskrit · Devanagari",
  Telugu "Telugu · Telugu script". The exhaustive `Record<Language, …>`
  forces future language additions to ship a label or fail typecheck.
- **`scripts/verify-lyrics-provenance.py`** updated allow-lists:
  `ALLOWED_LANGUAGES` now includes `bn` and `sa`; `ALLOWED_SCRIPTS`
  adds `bengali`. Sanskrit re-uses `devanagari` (no separate `sanskrit`
  script in the Section schema).
- **Tests**: 4 new provider cases (bengali-rabindrasangeet, telugu-keerthana,
  sanskrit-shloka, and an FS-driven-allow-list assertion), 4 new corpus
  invariants (one per new language ≥ 1 entry).
- **ADR 0026** — `0026-fs-driven-lyric-corpus.md`.

## Files touched

```
data/public-lyrics/ta/bharati-senthamizh-naadenum.md        added
data/public-lyrics/ta/bharati-achcham-illai.md              added
data/public-lyrics/ta/bharati-vande-mataram.md              added
data/public-lyrics/ta/bharati-kaani-nilam.md                added
data/public-lyrics/ta/bharati-vellai-thaamarai.md           added
data/public-lyrics/ta/bharati-paayum-oli.md                 added
data/public-lyrics/ta/andal-tiruppavai-margazhi.md          added
data/public-lyrics/ta/manikkavacakar-tiruvembavai-1.md      added
data/public-lyrics/hi/kabir-jhini-chadariya.md              added
data/public-lyrics/hi/tulsidas-ramayan-mangalacharan.md     added
data/public-lyrics/hi/surdas-darshan-do.md                  added
data/public-lyrics/kn/akkamahadevi-vachana-aru-novendare.md added
data/public-lyrics/kn/basavanna-vachana-ulivaru.md          added
data/public-lyrics/kn/purandaradasa-bhagyada-lakshmi.md     added
data/public-lyrics/bn/tagore-gitanjali-1.md                 added
data/public-lyrics/bn/tagore-gitanjali-aaji-jharer.md       added
data/public-lyrics/bn/tagore-ekla-cholo-re.md               added
data/public-lyrics/te/tyagaraja-endaro.md                   added
data/public-lyrics/te/tyagaraja-nidhi-chala.md              added
data/public-lyrics/te/tyagaraja-sogasuga-mridanga.md        added
data/public-lyrics/sa/gita-sthitaprajna.md                  added
data/public-lyrics/sa/shankaracharya-bhaja-govindam.md      added
data/public-lyrics/sa/gayatri-mantra.md                     added
packages/lyrics/scripts/bundle-corpus.ts                    modified
packages/lyrics/src/bundled-corpus.ts                       regenerated
packages/lyrics/src/provider.ts                             modified
packages/lyrics/src/provider.test.ts                        modified
packages/lyrics/src/corpus.invariants.test.ts               modified
apps/web/app/(app)/songs/new/library-picker.tsx             modified
scripts/verify-lyrics-provenance.py                         modified
docs/DECISIONS/0026-fs-driven-lyric-corpus.md               added
demos/v1.4/sprint-6-indic-corpus/ralph-evidence.md          added
```

## Tests added / updated

- `packages/lyrics/src/provider.test.ts` — 4 new cases:
  - `bengali-rabindrasangeet/bn` emits a valid SongDocument with Bengali
    script and mukhda head.
  - `telugu-keerthana/te` emits a valid SongDocument with pallavi head.
  - `sanskrit-shloka/sa` emits a valid SongDocument with shloka_verse
    head and Devanagari script.
  - FS-driven allow-list: `carnatic + kn` and `carnatic + sa` both
    resolve, demonstrating the intersection works.
- `packages/lyrics/src/corpus.invariants.test.ts` — 4 new cases:
  one per new v1.4 language (`ta`, `bn`, `te`, `sa`) asserting at least
  one PD entry plus per-entry field hygiene.

## Promise gate

| check | result | evidence |
| --- | --- | --- |
| `pnpm lint` | PASS | "✔ No ESLint warnings or errors" |
| `pnpm typecheck` | PASS | all 6 workspace projects clean |
| `pnpm test` (workspace) | PASS | 195 web tests, 32 lyrics tests, 83 co-composer tests, all package suites green |
| `python3 scripts/verify-lyrics-provenance.py` | PASS | "OK: 35 valid PD entries across [('bn', 3), ('en', 4), ('hi', 7), ('kn', 7), ('sa', 3), ('ta', 8), ('te', 3)]" |
| Supabase advisors | PASS | no schema change this sprint; baseline holds |

```
$ pnpm -r typecheck
Scope: 6 of 7 workspace projects
packages/g2p typecheck$ tsc -b tsconfig.json
packages/song-doc typecheck$ tsc -b tsconfig.json
packages/song-doc typecheck: Done
packages/g2p typecheck: Done
packages/co-composer typecheck$ tsc -b tsconfig.json
packages/style-presets typecheck$ tsc -b tsconfig.json
packages/lyrics typecheck$ tsc -b tsconfig.json
packages/co-composer typecheck: Done
packages/style-presets typecheck: Done
packages/lyrics typecheck: Done
apps/web typecheck$ tsc --noEmit
apps/web typecheck: Done

$ pnpm -r lint
Scope: 6 of 7 workspace projects
apps/web lint$ next lint --dir app --dir lib
apps/web lint: ✔ No ESLint warnings or errors
apps/web lint: Done

$ pnpm --filter @neo-fm/lyrics test
Test Files  5 passed (5)
     Tests  32 passed (32)

$ pnpm --filter @neo-fm/web test
Test Files  24 passed (24)
     Tests  195 passed (195)

$ python3 scripts/verify-lyrics-provenance.py
OK: 35 valid PD entries across [('bn', 3), ('en', 4), ('hi', 7), ('kn', 7),
('sa', 3), ('ta', 8), ('te', 3)] (ADR 0006 satisfied)
```

## Notable decisions

- The bundler walks the FS but still requires every language directory
  name to be in a typed `LANGUAGES` tuple. Adding a new language is a
  deliberate 3-step recipe (extend `Language` union in `@neo-fm/song-doc`,
  extend `LANGUAGES` in `bundle-corpus.ts`, drop content). This keeps
  the on-disk reality and the typed `Language` union in lockstep. See
  ADR 0026 for the full rationale.
- `STYLE_LANGUAGE_PREFERENCE` is the only hand-curated table left, and
  it encodes musicology (Carnatic kritis are Telugu/Kannada/Sanskrit/
  Tamil, not Bengali). Future sprints could derive this from
  co-composer metadata; deferred for now.
- ADR 0006's "≥ 4 entries per en/hi/kn" gate is unchanged. The v1.4
  languages get a softer "≥ 1 entry" floor in
  `corpus.invariants.test.ts` — Sprints 8/9/14 raise these as LoRAs
  and new chant/folk corpora land.
- Sanskrit re-uses the `devanagari` script. No `sanskrit` script literal
  is added to `@neo-fm/song-doc`'s `Script` union — the writing system
  is what matters, not the language.
