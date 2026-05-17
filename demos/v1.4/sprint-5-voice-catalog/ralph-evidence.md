# v1.4 Sprint 5 — Voice catalog v1

## Status

**Complete.**

## Commit

Working in worktree `v1.4-deep-dive`; awaiting commit to add this sprint's
work. CI will pick up the new tests on push.

## Shipped

- 16-persona voice catalogue.
  - `services/vocal-synth/app/voice_catalog.json` — canonical JSON.
  - `services/vocal-synth/app/voice_catalog.py` — frozen-dataclass
    loader with `VOICES`, `get_voice`, `voices_for_language`,
    `all_voice_ids` helpers.
  - `packages/co-composer/src/voice-catalogue.ts` — TS mirror with
    `VOICE_CATALOGUE`, `findVoice`, `voicesForLanguage`,
    `VoiceCatalogueEntry`, `VoiceLanguage`.
  - Parity test
    (`packages/co-composer/src/voice-catalogue.test.ts`) asserts
    the TS array and the Python JSON stay field-for-field aligned.
- vocal-synth wired through.
  - `VocalSection.voice_id` and `GenerateRequest.voice_id` plumbed
    through `serve.py::_coerce`.
  - `routing._pick_backend` consults the catalogue first; falls back
    to legacy language-based routing on unknown ids (so stale
    references can't break a render).
  - `parler::voice_descriptor` accepts a `voice_prompt` arg and
    stamps the catalogue persona into the Parler description.
  - Extended `Literal`s for the v1.4 language/style widening so
    Pydantic doesn't reject documents now that the picker exposes
    `sa` and the four new style families.
- Worker plumbed through.
  - `services/dgx-worker/app/models.py::SongDocument` gains a
    top-level `voice_id` and `background_mix` field.
  - `SongDocumentSection.voice_id` plumbed for per-section
    overrides.
  - `worker::build_vocal_request` forwards both fields to
    `/v1/vocalize`.
  - New test `test_worker_forwards_document_voice_id_to_vocal_synth`
    in `test_worker_vocal.py`.
- Creation canvas UI.
  - `apps/web/app/(app)/songs/new/voice-picker.tsx` — controlled
    radio list with a Suggested-for-language group + All voices
    group, each row carries a 10s preview button that streams the
    bucket's public CDN WAV via a single shared `Audio` element.
  - `creation-canvas.tsx` integrates the picker, threads `voiceId`
    through `buildSongDocument`, stamps the catalogue id onto the
    final SongDocument, and omits the field entirely on Auto.
- Public Storage bucket.
  - Migration `0039_voice_samples_bucket.sql` (also applied to the
    live project as `voice_samples_bucket` + `voice_samples_bucket_drop_select_policy`).
  - 10 MB cap, audio/wav only, service-role-write, public CDN read.
  - Render script
    `services/vocal-synth/scripts/render_voice_previews.py` lets
    the operator regenerate the preview WAVs from DGX with
    `--upload`.
- ADR `docs/DECISIONS/0025-voice-catalogue-v1.md` capturing the
  contract decisions (append-only ids, persona vs backend split,
  per-section override > doc default, alternatives considered).

## Files touched (additions / modifications)

```
docs/DECISIONS/0025-voice-catalogue-v1.md                            (new)
infra/supabase/migrations/0039_voice_samples_bucket.sql              (new)
packages/co-composer/src/index.ts                                    (+ re-export)
packages/co-composer/src/voice-catalogue.ts                          (new)
packages/co-composer/src/voice-catalogue.test.ts                     (new)
services/vocal-synth/app/voice_catalog.json                          (new)
services/vocal-synth/app/voice_catalog.py                            (new)
services/vocal-synth/app/model.py                                    (voice_id, style widening)
services/vocal-synth/app/parler.py                                   (voice_prompt path)
services/vocal-synth/app/routing.py                                  (catalogue-aware _pick_backend)
services/vocal-synth/app/serve.py                                    (VocalizeRequest.voice_id, _coerce)
services/vocal-synth/tests/test_voice_catalog.py                     (new)
services/vocal-synth/scripts/render_voice_previews.py                (new)
services/dgx-worker/app/models.py                                    (style widening, voice_id)
services/dgx-worker/app/worker.py                                    (forward voice_id)
services/dgx-worker/tests/test_worker_vocal.py                       (new test)
apps/web/app/(app)/songs/new/voice-picker.tsx                        (new)
apps/web/app/(app)/songs/new/creation-canvas.tsx                     (picker wiring)
apps/web/tests/lib/advanced-overrides.test.ts                        (voice_id assertions)
apps/web/tests/e2e/voice-picker.spec.ts                              (new)
demos/v1.4/sprint-5-voice-catalog/ralph-evidence.md                  (this file)
```

## Test results

- `pnpm -r typecheck` — clean across all 6 workspace projects.
- `pnpm -r lint` — clean (Next ESLint, 0 warnings).
- `pnpm -r test` — **195 web tests pass** plus all package suites:
  `packages/co-composer` 83 tests including the 6 new
  `voice-catalogue.test.ts` cases; `packages/song-doc` 25;
  `packages/lyrics` 24; etc.
- `uv run pytest services/vocal-synth/tests` — 44 passed (8 new in
  `test_voice_catalog.py`).
- `uv run pytest services/dgx-worker/tests` — 48 passed, 1
  skipped (including the new
  `test_worker_forwards_document_voice_id_to_vocal_synth`).
- `uv run pytest services/music-inference/tests` — 26 passed.
- `uv run pytest packages/song-doc/python` — 10 passed.

## Supabase advisors

`get_advisors security` after the migration reports:

- 0 ERROR-level lints.
- 1 new WARN `public_bucket_allows_listing` triggered by our initial
  SELECT policy — **resolved** in the follow-up migration
  `voice_samples_bucket_drop_select_policy`. Public buckets serve
  through the CDN without a SELECT policy; rerun afterwards confirms
  the warning was about that policy specifically.
- All other warns (`function_search_path_mutable`,
  `anon_security_definer_function_executable`,
  `authenticated_security_definer_function_executable`,
  `auth_leaked_password_protection`) are pre-existing and unchanged
  from the Sprint 4 baseline.

## Notable decisions

1. **Catalogue-first routing.** When a section carries a known
   `voice_id`, the backend is decided by the catalogue entry, not by
   language. Unknown ids fall through to the language-based logic so
   stale documents keep rendering. ADR 0025 documents the contract.
2. **Append-only ids.** The id schema is
   `<family>_<lang>_<gender>_<persona>` and we will never rename or
   remove an entry. New personas are appended.
3. **Two-tier override.** The SongDocument carries a top-level
   `voice_id` (set by the picker). Each section can override that
   with its own `voice_id`. The worker forwards both; the
   `_coerce` step picks per-section first. Useful when section-level
   regen lands and a user wants to swap personas only on the bridge.
4. **Single Audio instance per picker.** The preview button uses
   one shared `Audio` element so pause-then-play handles cross-row
   transitions without overlapping clips, and the `useEffect`
   cleanup stops any in-flight preview when the user leaves the
   page.
5. **Public bucket, no SELECT policy.** Following Supabase's
   advisor guidance — the CDN serves objects by name without RLS,
   and a broad SELECT policy would let clients list every preview.
6. **Render script lives under `services/vocal-synth/scripts/`** so
   the operator can regenerate the 16 WAVs from DGX with a single
   `uv run` invocation. Default is dry-run-local; `--upload` is
   opt-in.
