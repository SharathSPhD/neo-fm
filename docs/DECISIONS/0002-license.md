# ADR 0002: License — Apache-2.0

Status: Accepted (Phase 0, 2026-05-11).

## Context

The repository is public from day 1. It will bundle code that wraps:

- `m-a-p/HeartMuLa-oss-3B` — Apache-2.0.
- `kenpath/svara-tts` — open foundation model (license verified at Phase 7 integration).
- AI4Bharat Indic-TTS — open / MIT-style.

Picking a permissive license aligned with the core model weights minimizes friction for downstream users while keeping the project open.

## Decision

License the neo-fm repository under **Apache License 2.0**.

The full text lives at [LICENSE](../../LICENSE).

## Consequences

- Compatible with the HeartMuLa weight license out of the box.
- Allows commercial use, modification, and distribution with attribution.
- Includes an explicit patent grant — useful for any future contributors who hold AI/audio patents.
- Contributors implicitly license their contributions under Apache-2.0 by submitting a PR (see [CONTRIBUTING.md](../../CONTRIBUTING.md)).
- We do **not** add a CLA for v1 — too much process for the current contributor count.

## Superseded by

None.
