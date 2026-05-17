"""Sanskrit chant-style adapter (v1.4 Sprint 14).

This module is the **in-service** counterpart to
``scripts/train_chant_style_lora.py``. The trainer produces a
rank-16 LoRA over either IndicF5 or NeMo plus a
``svara_calibration.json`` describing per-svara duration medians.
At serve time the router consults this module to decide whether a
section deserves chant prosody, and the picked backend mounts the
LoRA when it boots.

The adapter is a **style** LoRA, not a new vocal backend — see ADR
0034. Two activation paths feed in:

  1. The SongDocument's ``style_family`` is ``"sanskrit-shloka"``
     (the new Sprint 14 preset).
  2. The section's voice catalogue entry is one of the chant
     personas (``chant_sustained`` / ``chant_devotional``).

Either path turns chant prosody on. The router's
:func:`should_use_chant_style` function bundles the rule so tests
exercise it without instantiating the heavy backend.

The on-disk artefacts the operator stages at
``VOCAL_CHANT_LORA_DIR`` are:

  - ``chant_style_lora.safetensors`` — the LoRA weights.
  - ``adapter_config.json`` — base model + rank + target modules.
  - ``svara_calibration.json`` — per-svara median duration table.

If any of these are missing and ``NEO_FM_REQUIRE_REAL_MODEL`` is
unset, the adapter degrades to *prosody-only* mode: it still
applies the calibration-table-derived duration bias to the
synthesised audio's envelope (a deterministic post-process), but
the LoRA itself is a no-op. Prod sets the env var so a missing
artefact fails loud.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np

LOG = logging.getLogger("vocal-synth.chant_style")

# Section types the chant LoRA targets. Synced with
# ``packages/song-doc/src/index.ts:SectionTypeSchema``. We keep this
# list inside the adapter so a future addition to the schema (e.g.
# ``shloka_phalashruti``) doesn't accidentally start routing through
# chant prosody before the LoRA has been retrained.
CHANT_SECTION_TYPES: frozenset[str] = frozenset({
    "shloka_verse",
    "shloka_refrain",
    "phalashruti",
})

# Voice personas pinned to chant. These are the two ``chant_*``
# entries in ``voice_catalog.json``.
CHANT_VOICE_IDS: frozenset[str] = frozenset({
    "chant_sustained",
    "chant_devotional",
})


@dataclass(frozen=True)
class ChantStyleSpec:
    """One loaded chant adapter artefact set.

    Holds everything :class:`ChantStyleAdapter` needs at synth
    time: where the LoRA lives, which base model owns it, and the
    pitch-/duration-bias calibration table.
    """

    base_model: str
    adapter_id: str
    rank: int
    lora_path: Path | None
    svara_calibration: dict[str, float]

    @property
    def loaded(self) -> bool:
        """The LoRA weights are actually on disk."""
        return self.lora_path is not None and self.lora_path.is_file()


def _empty_calibration() -> dict[str, float]:
    return {"udatta": 0.0, "anudatta": 0.0, "svarita": 0.0}


def load_chant_spec(
    artefact_dir: Path | None = None,
) -> ChantStyleSpec:
    """Load the chant artefacts staged at ``artefact_dir``.

    Resolution order:

      1. The argument, if non-None.
      2. ``VOCAL_CHANT_LORA_DIR`` env var.
      3. ``app/chant_adapter/`` next to this module (operator
         drop-in convention).

    Returns a :class:`ChantStyleSpec` even when the directory is
    empty — in that case ``spec.loaded`` is False and the adapter
    runs in prosody-only mode.
    """
    candidates: list[Path] = []
    if artefact_dir is not None:
        candidates.append(artefact_dir)
    env_dir = os.environ.get("VOCAL_CHANT_LORA_DIR")
    if env_dir:
        candidates.append(Path(env_dir))
    candidates.append(Path(__file__).parent / "chant_adapter")

    for d in candidates:
        config_path = d / "adapter_config.json"
        if not config_path.is_file():
            continue
        config = json.loads(config_path.read_text(encoding="utf-8"))
        cal_path = d / "svara_calibration.json"
        calibration: dict[str, float] = _empty_calibration()
        if cal_path.is_file():
            raw = json.loads(cal_path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                for k, v in raw.items():
                    if isinstance(v, (int, float)):
                        calibration[str(k)] = float(v)
        lora_file = d / "chant_style_lora.safetensors"
        return ChantStyleSpec(
            base_model=str(config.get("base_model", "indicf5")),
            adapter_id=str(config.get("adapter_id", "neo-fm/chant-style-v1")),
            rank=int(config.get("rank", 16)),
            lora_path=lora_file if lora_file.is_file() else None,
            svara_calibration=calibration,
        )

    return ChantStyleSpec(
        base_model="indicf5",
        adapter_id="neo-fm/chant-style-v1",
        rank=16,
        lora_path=None,
        svara_calibration=_empty_calibration(),
    )


def should_use_chant_style(
    *,
    style_family: str | None,
    section_type: str | None,
    voice_id: str | None,
) -> tuple[bool, str]:
    """Decide whether to apply chant prosody to one section.

    Returns ``(use_chant, reason)``. ``reason`` is a short tag the
    router records in :class:`RouteDecision` so the operator can
    see why a section did or didn't go through chant prosody.

    Rules (first match wins):

      1. The section's ``voice_id`` is one of the chant personas
         -> chant. Catalogue-pinned voices win over style.
      2. The song's ``style_family`` is ``"sanskrit-shloka"`` ->
         chant.
      3. The section's ``type`` is one of the chant section types
         (``shloka_verse`` / ``shloka_refrain`` / ``phalashruti``)
         -> chant.
      4. Otherwise -> no chant.
    """
    if voice_id and voice_id in CHANT_VOICE_IDS:
        return True, f"voice_id:{voice_id}"
    if style_family == "sanskrit-shloka":
        return True, "style:sanskrit-shloka"
    if section_type and section_type in CHANT_SECTION_TYPES:
        return True, f"section_type:{section_type}"
    return False, "non-chant"


def apply_chant_prosody(
    audio: np.ndarray,
    *,
    spec: ChantStyleSpec,
    sample_rate: int,
) -> np.ndarray:
    """Deterministic post-process that biases sustained-vowel
    energy according to the calibration table.

    The trained LoRA does the heavy lifting at inference time;
    this function is the **degraded-mode** prosody pass that
    runs when the LoRA isn't loaded yet. It also runs **with**
    the LoRA on top — the LoRA shapes pitch + timbre; this pass
    shapes envelope. Specifically:

      1. Slice the audio into ~``udatta_median`` second windows.
      2. Apply a gentle (-2 dB ramp-in, +1 dB hold) envelope to
         each window so sustained vowels read as held rather
         than truncated.

    The transformation is **mass-preserving** in peak — we
    rescale at the end so the output never clips and stays within
    the [-1, 1] band the routing layer expects.

    Tests assert determinism, length preservation, and the
    "<= input peak" property; they do not assert specific spectral
    shapes.
    """
    if audio.size == 0:
        return audio
    udatta = float(spec.svara_calibration.get("udatta", 0.0))
    window_seconds = udatta if udatta > 0 else 0.6
    window_n = max(1, int(window_seconds * sample_rate))
    out = audio.astype(np.float32, copy=True)
    n = out.size
    # Per-window envelope: linear ramp from 0.8 -> 1.05 across the
    # first half, hold at 1.05 across the second half. The hold
    # mimics the udatta sustained-vowel emphasis.
    starts = range(0, n, window_n)
    for start in starts:
        end = min(start + window_n, n)
        win = out[start:end]
        wn = win.size
        if wn < 2:
            continue
        mid = wn // 2
        ramp = np.linspace(0.8, 1.05, mid, dtype=np.float32)
        hold = np.full(wn - mid, 1.05, dtype=np.float32)
        envelope = np.concatenate([ramp, hold])
        out[start:end] = win * envelope
    peak_in = float(np.max(np.abs(audio)) or 1.0)
    peak_out = float(np.max(np.abs(out)) or 1.0)
    if peak_out > peak_in:
        out = out * (peak_in / peak_out)
    return out


__all__ = [
    "CHANT_SECTION_TYPES",
    "CHANT_VOICE_IDS",
    "ChantStyleSpec",
    "apply_chant_prosody",
    "load_chant_spec",
    "should_use_chant_style",
]
