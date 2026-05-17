# ADR 0034: Sanskrit / Vedic chant-style adapter

**Status:** Accepted
**Date:** 2026-05-17
**Sprint:** v1.4 Sprint 14

## Context

R2 §2.D calls Sanskrit "the undervalued goldmine" and a candidate
proprietary moat: no major TTS / SVS model targets Vedic prosody
(udatta / anudatta / svarita) specifically, even though the
classical Indian aesthetic the v1.4 plan targets (bhavageete,
shloka, devotional) depends on chant cadence. Sprint 12 wired
IndicF5 as a Sanskrit-capable backend; Sprint 13 added a custom
NeMo Kannada model. Neither is *chant-aware* — they speak Sanskrit
but don't shape sustained-vowel udatta, anudatta dips, or
svarita closers.

This sprint adds a **style adapter** — not a fifth vocal
backend — that the router activates whenever a section qualifies
as chant. The adapter is a rank-16 LoRA over whichever Sanskrit
backend has the higher baseline shloka MOS (Sprint 14 ships
``--base indicf5`` as the default; the operator can flip to
``nemo`` at retrain time if Sprint 16's eval reverses).

## Decision

We add four pieces:

  - ``app/chant_style.py`` — runtime adapter:
    :class:`ChantStyleSpec` (loaded artefact descriptor),
    :func:`should_use_chant_style` (routing rule),
    :func:`apply_chant_prosody` (always-on envelope pass).
  - ``scripts/curate_sanskrit_chant.py`` — corpus curation
    pipeline with ``--dry-run`` for CI. Augments the standard
    NeMo manifest with ``mantra_id`` + ``svara_marks`` columns.
  - ``scripts/train_chant_style_lora.py`` — rank-16 LoRA trainer
    on top of either IndicF5 or NeMo (``--base`` switch). Drops
    ``chant_style_lora.safetensors`` + ``adapter_config.json``
    + ``svara_calibration.json`` for the in-service loader.
  - ``packages/style-presets`` — new ``sanskrit-shloka`` preset
    pinned to the chant personas + chant section types
    (``shloka_verse`` / ``shloka_refrain`` / ``phalashruti``).

Routing additions:

  - :class:`RoutingVocalModel` accepts a ``chant_spec=`` argument
    (defaults to :func:`load_chant_spec`). The spec is loaded
    once at construction time so per-section dispatch stays
    O(1).
  - Per-section dispatch:
    :func:`should_use_chant_style` decides on-the-fly using
    three independent triggers: chant ``voice_id``,
    ``style_family == "sanskrit-shloka"``, or chant
    ``section.type``. First match wins.
  - :class:`RouteDecision` gains a ``chant_style_applied`` flag
    so the eval harness can attribute chant MOS to sections that
    actually went through the prosody pass.

### Why a style adapter, not a fifth backend

Backends embody **how** to make a voice (HuggingFace transformer
flavour, conditioning signal). Chant is **what** the voice should
do — slow, sustained, svara-aware — which is orthogonal. Making
chant a fifth backend would:

  - Force us to retrain the entire base model on Sanskrit chant
    (expensive, fragile to corpus quality).
  - Couple the Sanskrit language model to the chant aesthetic
    (we'd lose neutral Sanskrit recitation, e.g. for Vedic
    teaching material).
  - Double the number of cells in Sprint 16's reranker grid
    (5 backends × 10 styles instead of 4 × 10).

The style-LoRA approach is the same shape Sprints 8 / 9 used
for bhavageete + tamil-folk over HeartMuLa, and Sprint 10 used
for Carnatic + Hindustani over MusicGen. Sprint 14 picks the
same pattern up for chant — keeping the routing layer's mental
model uniform across music + voice.

### Why three independent activation triggers

A user can land on chant prosody three ways:

  1. **Style preset.** Picking ``sanskrit-shloka`` in the
     gallery sets ``style_family`` and the entire song goes
     through chant.
  2. **Per-section voice.** Composing a hindustani song with a
     chant_devotional bridge — the bridge section gets chant
     prosody even though the rest of the song doesn't.
  3. **Per-section type.** A user-defined ``shloka_verse``
     section embedded inside a non-shloka song.

Each trigger covers a real authoring path the plan calls out
(plan §15 demo seeding uses the section-type and preset paths;
the chant-personas test exists for users who hand-author
bridges). The rule precedence (voice > style > type) means
catalogue-pinned voices always win — operators editing the
catalogue can carve out exceptions without code changes.

### The always-on envelope pass

``apply_chant_prosody`` is **always** applied when a chant
activation fires, even when the LoRA artefacts aren't staged
(``spec.loaded == False``). The reasons:

  - The deterministic envelope is mass-preserving in peak and
    length — it can never regress audio worse than a chant-aware
    base model that already shaped the contour correctly.
  - The envelope alone produces a perceptible udatta sustain on
    bare IndicF5 output (manual A/B on the dry-run synthetic
    clips), so users get *some* chant character even when the
    operator hasn't staged the LoRA yet.
  - The LoRA does the heavy lifting at synthesise() time when
    mounted; the envelope is the always-on companion. They
    compose without double-shaping.

### Schema impact and reversibility

  - ``song-doc`` already shipped ``shloka_verse`` / ``shloka_refrain``
    / ``phalashruti`` SectionType entries and the
    ``sanskrit-shloka`` StyleFamily in Sprint 2. Sprint 14
    activates them — no schema migrations needed.
  - The chant preset uses chant voices (``chant_sustained``,
    ``chant_devotional``) which existed in the catalogue from
    Sprint 5. We pin them per-section in the preset so chant
    activation is unambiguous even without ``style_family``.
  - If Sprint 16's reranker shows the chant LoRA isn't helping,
    the operator can unstage ``VOCAL_CHANT_LORA_DIR`` and the
    runtime falls back to envelope-only chant; deactivating the
    feature entirely is a 1-line catalogue / preset edit.

## Soft-fail contract

Missing chant artefacts at startup -> :func:`load_chant_spec`
returns a :class:`ChantStyleSpec` with ``lora_path=None`` and
zero calibration. The router still applies the envelope pass
because it's mass-preserving and deterministic. Prod sets
``NEO_FM_REQUIRE_REAL_MODEL=1`` for the **base** backend (not the
chant LoRA) so a missing chant artefact is a warning, not a
job-killer — chant degrades to envelope-only.

## Acceptance evidence

- 128 vocal-synth tests pass (12 new for the chant_style module,
  8 new for curation, 9 new for training, 3 new for routing).
- ``ruff check`` clean across all Sprint 14 files.
- Style-presets TS suite passes (8 tests, including a new
  Sanskrit-shloka assertion + the gallery shape moving from 8 to
  9 cards).
- ``apps/web`` TS suite still passes (195 tests).
- Curation + LoRA training scripts both run successfully in
  ``--dry-run`` producing the expected on-disk artefacts.
