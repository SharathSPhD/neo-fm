# Sprint 4 — Phonetics + vocal-synth integration

**Status:** ✅ green
**Branch:** `v1.3-wedge`
**Author:** v1.3 wedge plan (auto)

## What shipped

### `packages/g2p` (new — long-promised by ADR 0010)

- Rule-pack G2P engine. No model loads. Pure TS, ~700 lines,
  deterministic, debuggable via `rule_traces[]`.
- Per-language packs:
  - **`hi`** (Devanagari): NFC normalisation, ZWJ/ZWNJ stripping
    (via the existing vocal-synth preprocessor), halant-double
    collapsing, aspirated-stop pairs (`kh`/`gh`/`th`/…), nukta
    handling (`क़→q`, `ज़→z`, `फ़→f`), anusvara place-assimilation
    (velar → `ng`, palatal → `ny`, retroflex → `N`, labial → `m`,
    dental → `n`), chandrabindu nasalisation (`~`), word-final
    schwa deletion.
  - **`hi`** (Latin / Hinglish): longest-match table for the
    bug-report offenders (`aa`/`ee`/`oo`/`ai`/`au`/`th`/`ph`/`kh`/
    `gh`/`dh`/`ch`/`sh`/`ng`/`ny`).
  - **`kn`** (Kannada): CV syllabification, virama clusters
    (`ನಮ್ಮ → n a m m a`), anusvara → `n`, visarga → `h`.
  - **`ta`** (Tamil): canonicalisation-only for v1.3 — script →
    Roman intermediate covering all 12 vowels + standard consonants
    + ௶/ழ/ள. Full sandhi-aware phonology is scheduled for v1.4 and
    flagged `ta:canonicalisation-only:v1.3` in the trace so the
    eval harness counts these separately.
  - **`en`** (Latin): passthrough with an Indic-phonotactics density
    probe — if a Roman string has more than 1.5 Hindi-hint hits per
    word, it routes through the Hindi-Latin pipeline (Hinglish).
- Output shape: `{ phonemes: string[]; syllables: Syllable[]; rule_traces:
  string[]; script: Script; language: Language }`. The phoneme list
  is single-token (`["k","a","m","a","l"]`, not `["kamal"]`) so the
  Indic-Parler tokeniser keys on each phoneme rather than the
  word as a unit.
- `phonemesForSection({ language, lyrics, transliteration, script })`:
  the wrapper co-composers call. Returns `[]` for instrumental /
  no-lyric sections; prefers `transliteration` when both are set.

### Minimal-pair regression fixtures

- `packages/g2p/tests/minimal-pairs/hi-schwa.json` (5 cases) — the
  word-final schwa rule that v1 got audibly wrong (`नमस्कार`,
  `कमल`, `राम`, `गाँव`, `घर`).
- `packages/g2p/tests/minimal-pairs/hi-nasal.json` (4 cases) —
  anusvara place assimilation across the four primary stop places.
- `packages/g2p/tests/minimal-pairs/kn-syllables.json` (4 cases) —
  CV / CCV cluster / vowel-initial / anusvara+cluster.
- `packages/g2p/tests/minimal-pairs/ta-canonical.json` (3 cases) —
  baseline Tamil-script → Roman canonical.
- All four fixtures pass at 100%; any regression here is a
  singing-quality regression.

### Co-composer phoneme emission

- `packages/co-composer/src/phonemes.ts` (new) — single shared
  `attachPhonemes(doc)` helper. Per-section: skips when language is
  English / phonemes already supplied / no lyrics; otherwise fills
  `section.phonemes` via `phonemesForSection`.
- Wired into every composer's `elaborate()` tail:
  `CarnaticCoComposer`, `HindustaniCoComposer`,
  `KannadaFolkCoComposer`, `KannadaLightClassicalCoComposer`,
  `TamilFolkCoComposer`, `WesternCoComposer`. English is a no-op
  (the English G2P path passes through Roman words, which is noise
  in the vocal payload).
- Producer veto preserved: any `section.phonemes` already on the
  document survives untouched.

### vocal-synth integration (the long-promised wiring)

- `services/vocal-synth/app/serve.py` lifespan now installs
  `RoutingVocalModel` by default (`VOCAL_MODEL_BACKEND=routing`).
  Existing `svara`/`parler` operators still pin a single backend
  via the env var. The router was dead code through v1.2; v1.3
  makes it the prod default.
- `services/vocal-synth/app/routing.py` now actually consumes
  `preprocess_section()` output instead of running it for side-
  effects. The router:
  1. If `section.phonemes` is non-empty, splices them into the
     backend's `transliteration` (space-joined) and stamps
     `script="ipa"`. Backends that tokenise on `transliteration`
     (Svara, Parler) now see the canonical pronunciation, not
     the raw surface form.
  2. Else, if the preprocessor emitted prepared utterances
     (Hinglish `[ipa:…]`, segmented, prosody-hinted), splices
     those in. The original `VocalSection` is never mutated — a
     `dataclasses.replace` clone keeps the frozen-dataclass
     contract intact.
- `VocalSection.phonemes: tuple[str, ...] | None` (new). The dataclass
  stays frozen-hashable.
- `VocalizeRequest.style_family` Literal extended with
  `kannada-light-classical` + `tamil-folk` (Sprint 2 schema
  finally reaches the FastAPI wire model).
- `VocalizeRequestSection.phonemes: list[str] | None` (new).
  Legacy producers that omit the field are still accepted; the
  router treats `None` as "fall back to preprocessor output".

### Worker forwarding

- `services/dgx-worker/app/worker.py` `build_vocal_request` now
  forwards `section.phonemes` into the `/v1/vocalize` payload.
  Older Song Documents without the field pass through as `None`.

### Tests

- `@neo-fm/g2p` vitest: 27 cases (22 minimal-pair + 5
  helper/integration).
- `@neo-fm/co-composer` vitest: 67 cases (+6 new in
  `phonemes.test.ts` exercising the 5 composers' emission +
  producer-veto + the no-phonemes-on-English rule).
- `services/vocal-synth` pytest: 36 cases (+2 new in
  `test_routing.py` for the phoneme-splice path and the
  preprocessor-fallback path).
- `services/dgx-worker` pytest: 48 cases (+1 new in
  `test_worker_vocal.py` for `section.phonemes` survival across
  `build_vocal_request` → `/v1/vocalize`).

## Ralph gate

See [`ralph-evidence.md`](./ralph-evidence.md). All checks pass:

| Check                                                         | Result          |
|---------------------------------------------------------------|-----------------|
| `@neo-fm/g2p` minimal-pair regression                         | 22/22 ✅        |
| `@neo-fm/co-composer` phoneme-emission tests                  | 6/6 ✅          |
| `services/vocal-synth` RoutingVocalModel wired in lifespan    | confirmed ✅    |
| `services/vocal-synth` phoneme + prepared-utterance splice    | 2/2 ✅          |
| `services/dgx-worker` forwards `section.phonemes`             | 1/1 ✅          |
| Whole-workspace TS test sweep                                 | 263/263 ✅      |
| Whole-services pytest sweep                                   | 124/124 (1 skip) ✅ |
| `pnpm -r --filter '@neo-fm/*' build`                          | green ✅        |

## Out of scope (carried forward)

- **Tamil sandhi rules** (medial-schwa-style phonology). v1.3 ships
  canonicalisation only; v1.4 picks up the depth.
- **Cross-syllable voicing assimilation** beyond the anusvara rule
  (e.g. `सब्ज़ी` → `s-a-b-z-ii` is correct, but `तब बात` (`tab baat`)
  → final-/p/ voicing across word boundary is not modeled).
- **Backend-side phoneme tokeniser swap**. The Indic-Parler model
  consumes `transliteration`; we splice phonemes into that field.
  A model release that takes a dedicated `phonemes[]` channel
  would only require a 3-line change here.
