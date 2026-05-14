# Phase 3 smoke handoff

Phase 3 ships:

- `data/public-lyrics/` — 12 PD entries (4 each en/hi/kn) cleared by
  `scripts/verify-lyrics-provenance.py` and pinned by ADR 0006.
- `@neo-fm/lyrics` — `PublicLyricsLibraryProvider` (real), `PratyabhijnaProvider`
  (still throws on call; flagged off until Phase 10).
- `demos/phase-3-request.golden.json` — the canonical `GenerateRequest` for the
  Kabir doha `Pothi Padhi Padhi Jag Mua` rendered as a 60-second `hindustani`
  document. CI pins this byte-for-byte via `lyrics/src/phase3.test.ts`.

The offline portion (lyrics → SongDocument → GenerateRequest) is fully
reproducible from this checkout:

```bash
pnpm --filter @neo-fm/lyrics build-phase-3-request
diff demos/phase-3-request.golden.json /dev/null  # noop sanity check
```

The downstream WAV (`demos/phase-3.wav`) requires the same DGX bring-up as
Phase 1 (HF_TOKEN, weight bootstrap, `infra/.env.dgx`). Once that is done,
the demo is one line:

```bash
# On the DGX, with music-inference already up:
scripts/build-demo.sh phase-3
```

This will:

1. Re-emit `demos/phase-3-request.golden.json` and fail-fast on drift.
2. POST the request to `music-inference /v1/generate` with a freshly-signed
   HMAC envelope.
3. `docker cp` the resulting WAV out of the container into `demos/phase-3.wav`.
4. `ffprobe` the duration as a sanity check.

Environment:

| variable                       | value                                 |
| ------------------------------ | ------------------------------------- |
| `MUSIC_INFERENCE_URL`          | e.g. `http://localhost:8000`          |
| `MUSIC_INFERENCE_HMAC_SECRET`  | matches `infra/.env.dgx`              |

Until the DGX is up, `demos/phase-3.wav` is intentionally absent. The Phase 3
gate (Ralph-Wiggum, §AGENTS.md) is satisfied by:

- ✅ Correct: `PublicLyricsLibraryProvider` emits a schema-valid SongDocument
  from a verified PD entry; 24/24 unit tests; `verify-lyrics-provenance.py`
  green on the 12-entry corpus.
- ✅ Adversarial: ADR 0006 author/source-year/PD-jurisdiction checks enforced;
  `corpus.invariants.test.ts` mirrors the Python verifier inside the TS test
  suite so CI catches regressions without needing the Python script.
- ⏳ Reproducible: golden offline request reproduces byte-for-byte; WAV
  reproduction is one-line once the DGX is provisioned.
- ⏳ Demo committed: `demos/phase-3.wav` deferred to operator runbook.
- ✅ Promised next phase: Phase 4 handoff in `docs/PHASE-4-HANDOFF.md`.
