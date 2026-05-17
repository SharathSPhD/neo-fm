# v1.4 Sprint 13 — voice benchmark (PROXY / DRY-RUN)

Prompts: 16 · Backends: svara, parler, indicf5, nemo · Dry-run: **True**

**These are deterministic proxy scores, not human MOS.** All columns
show the 5.00 ceiling that our CI rubric returns on zero-byte
placeholder audio. This benchmark exists to prove the harness wiring;
real MOS requires DGX-rendered audio and a human panel. The NeMo row
specifically reports the same proxy ceiling because Sprint 13's
`train_kannada_nemo.py --dry-run` only emits 1-byte `.nemo`
placeholders.

## Per-prompt detail (proxy)

| prompt_id | language | voice_id | svara proxy MOS / consistency / sec | parler proxy MOS / consistency / sec | indicf5 proxy MOS / consistency / sec | nemo proxy MOS / consistency / sec |
| --- | --- | --- | --- | --- | --- | --- |
| hi-01 | hi | indic_hi_male_broadcast | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.01s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.01s |
| hi-02 | hi | indic_hi_female_lyrical | 5.00 / 0.52 / 0.01s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s |
| hi-03 | hi | indic_hi_male_broadcast | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s |
| hi-04 | hi | indic_hi_female_lyrical | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s |
| ta-01 | ta | indic_ta_female_devotional | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s |
| ta-02 | ta | indic_ta_male_nadaswaram | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s |
| ta-03 | ta | indic_ta_female_devotional | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s |
| ta-04 | ta | indic_ta_male_nadaswaram | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s |
| bn-01 | bn | indic_bn_male_rabindra | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s |
| bn-02 | bn | indic_bn_female | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s |
| bn-03 | bn | indic_bn_male_rabindra | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s |
| bn-04 | bn | indic_bn_female | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s |
| te-01 | te | indic_te_female | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s |
| te-02 | te | indic_te_male | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s |
| te-03 | te | indic_te_female | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s |
| te-04 | te | indic_te_male | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s |


## Per-backend means (proxy)

| backend | n | mean proxy MOS | mean consistency | mean seconds |
| --- | --- | --- | --- | --- |
| svara | 16 | 5.0 | 0.521 | 0.003 |
| parler | 16 | 5.0 | 0.521 | 0.003 |
| indicf5 | 16 | 5.0 | 0.521 | 0.003 |
| nemo | 16 | 5.0 | 0.521 | 0.003 |
