# ADR 0010: Phase 7 vocal stack — licensing prerequisites gate

Status: Proposed (blocking Phase 7)

## Context

Phase 7 ([SPEC §3.7][SPEC], [IMPLEMENTATION_PLAN §Phase 7][PLAN]) introduces
Indic phonetics + vocal synthesis: a Devanagari/Kannada G2P front-end and a
small `services/vocal-synth` container that turns lyric + raga + section
metadata into a vocal stem the music-inference output can be mixed against.

[SPEC]: ../SPEC.md
[PLAN]: ../IMPLEMENTATION_PLAN.md

The candidate Phase 7 components are all third-party research artifacts:

| Component             | Source                                     | License status (as of this ADR) |
| --------------------- | ------------------------------------------ | ------------------------------- |
| svara-TTS             | IIT-M speech lab, raga-conditioned TTS     | License **unset** in published artifacts (SPEC §187); contact required |
| Kenpath ("Sruti")     | Kenpath Research TTS for Indian languages  | License **unset** in HF model cards (SPEC §189); contact required |
| AI4Bharat Indic-TTS   | AI4Bharat (IIT-M)                          | Research / CC variants per model; per-model review required |
| IITM-CLS              | IIT-M Common Label Set phoneme inventory   | Documented as **research-use only** (SPEC §192) |

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
