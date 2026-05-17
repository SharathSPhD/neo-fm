# v1.4 Sprint 12 — voice benchmark (PROXY / DRY-RUN)

Prompts: 16 · Backends: svara, parler, indicf5, nemo · Dry-run: **True**

**These are deterministic proxy scores, not human MOS.** Every backend
column reports the synthetic 5.00 ceiling our CI rubric returns on
zero-byte placeholder audio. Treat these tables as smoke-test
fixtures, not as listener-evaluation evidence. A real listening MOS
requires DGX-run audio + a human panel; see
`evals/v1.4-bench/README.md`.

## Per-prompt detail (proxy)

| prompt_id | language | voice_id | svara proxy MOS / consistency / sec | parler proxy MOS / consistency / sec | indicf5 proxy MOS / consistency / sec | nemo proxy MOS / consistency / sec |
| --- | --- | --- | --- | --- | --- | --- |
| hi-01 | hi | indic_hi_male_broadcast | 5.00 / 0.52 / 0.01s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | not-available |
| hi-02 | hi | indic_hi_female_lyrical | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | not-available |
| hi-03 | hi | indic_hi_male_broadcast | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | not-available |
| hi-04 | hi | indic_hi_female_lyrical | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | not-available |
| ta-01 | ta | indic_ta_female_devotional | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | not-available |
| ta-02 | ta | indic_ta_male_nadaswaram | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | not-available |
| ta-03 | ta | indic_ta_female_devotional | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | not-available |
| ta-04 | ta | indic_ta_male_nadaswaram | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | not-available |
| bn-01 | bn | indic_bn_male_rabindra | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | not-available |
| bn-02 | bn | indic_bn_female | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | not-available |
| bn-03 | bn | indic_bn_male_rabindra | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | not-available |
| bn-04 | bn | indic_bn_female | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | not-available |
| te-01 | te | indic_te_female | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | not-available |
| te-02 | te | indic_te_male | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | not-available |
| te-03 | te | indic_te_female | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | not-available |
| te-04 | te | indic_te_male | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | 5.00 / 0.52 / 0.00s | not-available |


## Per-backend means (proxy)

| backend | n | mean proxy MOS | mean consistency | mean seconds |
| --- | --- | --- | --- | --- |
| svara | 16 | 5.0 | 0.521 | 0.003 |
| parler | 16 | 5.0 | 0.521 | 0.003 |
| indicf5 | 16 | 5.0 | 0.521 | 0.003 |
| nemo | 0 | 0.0 | 0.0 | 0.0 |
