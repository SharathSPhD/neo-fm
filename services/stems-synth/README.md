# neo-fm stems-synth

v1.4 Sprint 11 sidecar — short instrumental clips (4-8s) on demand:
section transitions (tabla rolls, mridangam tihais, parai breaks),
percussion beds, ambient drone washes (tanpura/shloka).

Implementation:
- **Model:** Stable Audio Open 1.0 (1.2 B params, MIT-licensed, ≤47s
  clips). Loaded onto GPU at FP16 (~12 GB VRAM).
- **Adapter:** A rank-16 short-clip LoRA fine-tuned on Saraga/MUSDB
  percussion + tanpura stems (Sprint 11 trains it on DGX). When
  loaded, the adapter is activated for `style_family ∈
  {carnatic,hindustani,kannada-light-classical,tamil-folk,
  sanskrit-shloka}`.
- **Contract:** `POST /v1/generate-stem` returns a 16-bit / 44.1 kHz
  WAV. The request body specifies a preset (`tabla_tihai`,
  `parai_break`, `tanpura_drone`, …) or a free-text prompt.

Internal API; never internet-facing. HMAC-authenticated per ADR 0003.
Structured JSON logs per ADR 0007. Prometheus metrics on `/metrics`.

## CI

Tests use `FakeStemModel` (deterministic silence) so CI never pulls
torch or stable-audio-tools.

## Operator runbook

See `docs/DECISIONS/0031-stable-audio-open-stems.md`.
