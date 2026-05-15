# ADR 0010: Phase 7 vocal stack — licensing prerequisites gate

Status: Accepted (Phase 7 unblocked on 2026-05-15 via two viable candidates)

## Context

Phase 7 ([SPEC §3.7][SPEC], [IMPLEMENTATION_PLAN §Phase 7][PLAN]) introduces
Indic phonetics + vocal synthesis: a Devanagari/Kannada G2P front-end and a
small `services/vocal-synth` container that turns lyric + raga + section
metadata into a vocal stem the music-inference output can be mixed against.

[SPEC]: ../SPEC.md
[PLAN]: ../IMPLEMENTATION_PLAN.md

The candidate Phase 7 components are all third-party research artifacts:

| Component             | Source                                     | License status (verified 2026-05-15) |
| --------------------- | ------------------------------------------ | ----------------------------------- |
| svara-TTS (IIT-M)     | IIT-M speech lab, raga-conditioned TTS     | Not on HF; license still unset in publications. **Defer** |
| Kenpath svara-tts-v1  | Kenpath Research TTS for Indian languages  | **Apache-2.0** on HF model card; Llama-3.2 base via two Orpheus checkpoints. Reviewed in `docs/licenses/kenpath--svara-tts-v1.review.md`. **Accept** |
| AI4Bharat Indic-TTS   | AI4Bharat (IIT-M)                          | `ai4bharat/indic-parler-tts` and `-pretrained` both **Apache-2.0** (gated). Reviewed in `docs/licenses/ai4bharat--indic-parler-tts.review.md`. **Accept** |
| IITM-CLS              | IIT-M Common Label Set phoneme inventory   | Inventory only — labels usable as an alphabet; training audio and dictionaries are **not** redistributed. Phase 7 G2P code may reference CLS labels with citation. |

The project's commercial posture is set by [ADR 0002][ADR2]: HeartMuLa-OSS
is the production music model precisely because its license permits
self-hosted commercial inference. Phase 7 must not break that posture.

[ADR2]: 0002-license.md

The contradiction (C-license): we want vocal synthesis *now* (it's the next
step after Phase 6 styles to make the songs feel finished) AND we want to be
*never* in a position where a paid user generates a song whose vocal stem
came from a model we don't have the right to serve commercially.

## Decision

Phase 7 is **gated** behind a per-component license review. No code lands in
`services/vocal-synth/` and no model is downloaded onto DGX until the
following evidence is captured *in this repository*, for each model we
intend to ship:

1. **License grant on file.** Either:
   - An OSI-approved or Creative Commons license file in the model
     distribution (preferred: MIT, Apache-2.0, CC-BY, CC-BY-SA), with the
     SHA-256 of the LICENSE blob recorded under
     `docs/licenses/<model>.LICENSE.sha256`, **or**
   - A written grant from the rights-holder (email or signed letter)
     archived under `docs/licenses/<model>-grant.md`, summarizing the
     scope (self-hosted inference, commercial users, attribution
     requirements, modification rights) and naming the contact who signed
     off.

2. **Attribution surface decided.** If the license requires attribution,
   the UI surface that will carry it (e.g. a "Credits" route, an
   inline "vocals by" footer, a per-track metadata field) is identified
   and tracked as a Phase 7 task before the code is written.

3. **Commercial use confirmed compatible.** The license grant covers:
   - inference on user prompts (not just research replication);
   - paid-tier users (the PRD's creator and pro tiers);
   - hosting on third-party hardware (DGX in our case).

4. **No CC-NC, no research-only, no "ask permission per use".** Any
   component that fails (1)–(3) is removed from the Phase 7 candidate
   set, even if the technical fit is excellent. We will ship vocals
   later or not at all in that style, rather than ship them on a
   license we can't defend.

For IITM-CLS specifically, since it is the phoneme inventory rather than a
model:
- Use of CLS *labels* as an inventory in our own code is treated as
  using an alphabet, not redistribution of the dataset.
- We **must not** copy IITM-CLS training audio or alignment data into
  this repo, and any G2P rules that derive directly from CLS dictionaries
  must cite the source in `packages/g2p/CITATIONS.md` and respect the
  research-use scope by keeping derived data out of the trained model
  artifacts.

When all gating evidence for at least one viable vocal model is on file,
Phase 7 may start. ADR 0010 will be amended (or a successor ADR opened)
to record the accepted model and link to the captured license artifacts.

### Resolution (2026-05-15)

Two HF-resident models clear the gate:

- `kenpath/svara-tts-v1` — Apache-2.0 (LoRA on Orpheus-3B, which is
  Apache-2.0 on top of Meta `Llama-3.2-3B-Instruct` under the Llama
  3.2 Community License). See
  [docs/licenses/kenpath--svara-tts-v1.review.md][R1].
- `ai4bharat/indic-parler-tts` — Apache-2.0, gated. See
  [docs/licenses/ai4bharat--indic-parler-tts.review.md][R2].

Both cover the project's target Indian languages (Hindi, Kannada,
Sanskrit) and both clear ADR 0010's commercial-use checklist. Phase 7
implementation is unblocked. Carrying two compatible options de-risks
Phase 7 against an upstream re-license. Llama 3.2 Community License's
700M-MAU clause is not a blocker at neo-fm's current scale and will be
re-evaluated alongside any future scale milestone.

[R1]: ../licenses/kenpath--svara-tts-v1.review.md
[R2]: ../licenses/ai4bharat--indic-parler-tts.review.md

## Consequences

### Positive

- Phase 7 cannot accidentally re-introduce a non-commercial constraint
  through the back door. The next reviewer can see at a glance what
  license the vocal stem is under.
- Aligns Phase 7 with the same standard ADR 0002 set for Phase 1
  (HeartMuLa-OSS chosen because of its license, not despite it).
- Splits the "do the engineering" decision from the "are we allowed to
  ship it" decision, so engineering work can proceed on the G2P layer
  (`packages/g2p/`) without depending on any specific TTS model.

### Negative / costs

- Adds a paperwork step before Phase 7 can start. The team must do at
  least one round of outreach to svara-TTS / Kenpath authors, or accept
  whatever AI4Bharat model variants carry a clear permissive license.
- A delay in license confirmation directly delays the user-visible
  vocal feature.
- We may end up with a smaller Phase 7 surface than originally planned
  if no Indian-language TTS that satisfies (1)–(3) is available — the
  fallback is to ship raga-conditioned humming / scat lines from
  HeartMuLa rather than lyric-pronouncing vocals.

### Operational

- A new directory `docs/licenses/` is reserved for the artifacts.
  Adding it here as a placeholder keeps the path real for reviewers
  even before Phase 7 starts.
- `services/vocal-synth/` and `packages/g2p/` are explicitly forbidden
  from depending on, downloading, or shipping any model whose license
  evidence is not present under `docs/licenses/`. A CI check can be
  added in Phase 7 itself to enforce this.

## Out of scope

- The technical design of the vocal-synth container (model loading,
  audio mixing, raga conditioning). That is Phase 7 implementation
  work, deliberately deferred.
- Lyric provenance — already covered by [ADR 0006][ADR6].

[ADR6]: 0006-lyrics-provenance.md
