"""
`RoutingVocalModel`: language-aware backend picker (Sprint D, ADR 0020).

The vocal-synth service used to be a single-backend pipeline: load
Svara-TTS, run it for every section, ship the audio. v1.1's deep-dive
review showed that:

  - Svara handles Hindi/Kannada Devanagari/Kannada-script text well.
  - Indic Parler-TTS is currently the best free Hinglish handler
    (Latin-script Hindi) and the most natural for English.
  - Neither model is the right call for all four song styles.

The router picks per **section** (not per request) so a song that has
a Sanskrit pallavi followed by an English bridge can use the right
model in each segment. It also exposes a `target_backend(section)`
hook the eval harness uses to A/B candidate routes.

Backends are loaded lazily: the first time a route picks a backend
that hasn't been loaded, we call `.load()` and cache it. If the load
fails and `NEO_FM_REQUIRE_REAL_MODEL=1`, we re-raise; otherwise we
fall back to the `FakeVocalModel` for that segment so the rest of
the song still ships.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from typing import Literal

import numpy as np

from .chant_style import (
    ChantStyleSpec,
    apply_chant_prosody,
    load_chant_spec,
    should_use_chant_style,
)
from .indicf5 import IndicF5Model
from .model import (
    FakeVocalModel,
    SvaraTTSModel,
    VocalRequest,
    VocalSection,
    _write_wav_mono,
)
from .nemo import NeMoTTSModel
from .parler import ParlerTTSModel
from .preprocess import preprocess_section
from .voice_catalog import get_voice

BackendKey = Literal["svara", "parler", "indicf5", "nemo", "fake"]


@dataclass
class RouteDecision:
    """Diagnostic record of which backend handled a section."""

    section_id: str
    backend: BackendKey
    reason: str
    # v1.4 Sprint 14: was the chant-style adapter activated for
    # this section? ``None`` means "not asked"; ``False`` means
    # asked + declined; ``True`` means the chant prosody pass
    # ran. The eval harness inspects this to attribute chant MOS.
    chant_style_applied: bool | None = None


def _pick_backend(section: VocalSection) -> tuple[BackendKey, str]:
    """Pure routing logic, exposed for tests.

    Rules (first match wins):

      0. (v1.4 Sprint 5) Section carries a ``voice_id`` resolved in the
         catalogue -> use that entry's backend. Unknown ids fall
         through to the language-based decision so a stale id never
         breaks a render.
      1. Instrumental / empty section -> `fake` (cheap silence).
      2. Latin-script text in any non-English language -> `parler`
         (Parler's voice descriptors carry pronunciation hints
         better than Svara for Romanised input).
      3. Language is English -> `parler` (Svara is Indic-only).
      4. Otherwise (Devanagari / Kannada / Tamil / Telugu / Bengali
         in their native scripts) -> `svara`.
    """
    if section.voice_id:
        entry = get_voice(section.voice_id)
        if entry is not None:
            # v1.4 Sprint 12: IndicF5 lands as a real third route.
            # NeMo (Sprint 13) is still future; future-only backends
            # fall back to parler so a catalogue entry tagged "nemo"
            # before the model exists doesn't break a render.
            if entry.backend == "parler":
                return "parler", f"voice_id:{entry.voice_id}"
            if entry.backend == "svara":
                return "svara", f"voice_id:{entry.voice_id}"
            if entry.backend == "indicf5":
                return "indicf5", f"voice_id:{entry.voice_id}"
            if entry.backend == "nemo":
                return "nemo", f"voice_id:{entry.voice_id}"
            return "parler", f"voice_id:{entry.voice_id}:fallback_to_parler"
    if section.type == "instrumental" or not (section.lyrics or section.transliteration):
        return "fake", "no-text"
    text = section.transliteration or section.lyrics or ""
    script = (section.script or "").lower()
    if not script:
        script = "latin" if all(ord(c) < 128 for c in text) else "devanagari"
    if section.language == "en":
        return "parler", "english-text"
    if script == "latin":
        return "parler", "latin-script-indic"
    return "svara", "native-script-indic"


class RoutingVocalModel:
    """Composite model that picks a backend per section."""

    def __init__(
        self,
        *,
        svara: SvaraTTSModel | None = None,
        parler: ParlerTTSModel | None = None,
        indicf5: IndicF5Model | None = None,
        nemo: NeMoTTSModel | None = None,
        fallback: FakeVocalModel | None = None,
        chant_spec: ChantStyleSpec | None = None,
    ) -> None:
        self._svara = svara or SvaraTTSModel(
            os.environ.get("VOCAL_MODEL_ID_SVARA", "kenpath/svara-tts-v1"),
        )
        self._parler = parler or ParlerTTSModel(
            os.environ.get("VOCAL_MODEL_ID_PARLER", "ai4bharat/indic-parler-tts"),
        )
        self._indicf5 = indicf5 or IndicF5Model(
            os.environ.get("VOCAL_MODEL_ID_INDICF5", "ai4bharat/IndicF5"),
        )
        self._nemo = nemo or NeMoTTSModel()
        # Fallback is constructed lazily: FakeVocalModel refuses to
        # exist when NEO_FM_REQUIRE_REAL_MODEL=1, and the prod path
        # never reaches it. We only allocate it on first use.
        self._fallback_factory = (lambda: fallback) if fallback is not None else FakeVocalModel
        self._fallback: FakeVocalModel | None = fallback
        self._svara_loaded = False
        self._parler_loaded = False
        self._indicf5_loaded = False
        self._nemo_loaded = False
        self._chant_spec = chant_spec if chant_spec is not None else load_chant_spec()
        self._last_decisions: list[RouteDecision] = []

    @property
    def chant_spec(self) -> ChantStyleSpec:
        return self._chant_spec

    def _get_fallback(self) -> FakeVocalModel:
        if self._fallback is None:
            self._fallback = self._fallback_factory()
        return self._fallback

    @property
    def model_loaded(self) -> bool:
        # A routing model is loaded if at least one real backend is
        # available; the fallback is always loadable.
        return (
            self._svara_loaded
            or self._parler_loaded
            or self._indicf5_loaded
            or self._nemo_loaded
        )

    @property
    def model_version(self) -> str | None:
        parts = []
        if self._svara_loaded:
            parts.append(f"svara={self._svara.model_version}")
        if self._parler_loaded:
            parts.append(f"parler={self._parler.model_version}")
        if self._indicf5_loaded:
            parts.append(f"indicf5={self._indicf5.model_version}")
        if self._nemo_loaded:
            parts.append(f"nemo={self._nemo.model_version}")
        if not parts:
            return "routing+fake"
        return "routing+" + ",".join(parts)

    @property
    def last_decisions(self) -> list[RouteDecision]:
        return list(self._last_decisions)

    def _ensure_backend(self, key: BackendKey) -> object:
        require_real = os.environ.get("NEO_FM_REQUIRE_REAL_MODEL") == "1"
        if key == "svara":
            if not self._svara_loaded:
                try:
                    self._svara.load()
                    self._svara_loaded = True
                except Exception:
                    if require_real:
                        raise
                    return self._get_fallback()
            return self._svara
        if key == "parler":
            if not self._parler_loaded:
                try:
                    self._parler.load()
                    self._parler_loaded = True
                except Exception:
                    if require_real:
                        raise
                    return self._get_fallback()
            return self._parler
        if key == "indicf5":
            if not self._indicf5_loaded:
                try:
                    self._indicf5.load()
                    self._indicf5_loaded = True
                except Exception:
                    if require_real:
                        raise
                    return self._get_fallback()
            return self._indicf5
        if key == "nemo":
            if not self._nemo_loaded:
                try:
                    self._nemo.load()
                    self._nemo_loaded = True
                except Exception:
                    if require_real:
                        raise
                    return self._get_fallback()
            return self._nemo
        return self._get_fallback()

    def synthesise(self, req: VocalRequest) -> bytes:
        sr = req.sample_rate
        chunks: list[np.ndarray] = []
        decisions: list[RouteDecision] = []
        for sec in req.sections:
            key, base_reason = _pick_backend(sec)
            use_chant, chant_reason = should_use_chant_style(
                style_family=req.style_family,
                section_type=sec.type,
                voice_id=sec.voice_id,
            )
            reason = (
                f"{base_reason}+chant:{chant_reason}" if use_chant else base_reason
            )
            decisions.append(
                RouteDecision(
                    section_id=sec.id,
                    backend=key,
                    reason=reason,
                    chant_style_applied=False if not use_chant else None,
                )
            )
            # v1.3 Sprint 4: actually consume the preprocessor output
            # instead of running it for trace-only side-effects. The
            # backends still take a `VocalSection`, so we splice the
            # prepared utterance text into `transliteration` (the
            # field they tokenise against) and stamp `script="ipa"` if
            # the Hinglish hinter wrapped anything. If the producer
            # supplied phonemes via @neo-fm/g2p (Sprint 4 co-composer
            # path), we prefer those: a phoneme stream is a canonical
            # pronunciation hint that beats raw text for the Indic
            # backends. We *never* mutate the original `sec` -- a
            # cloned VocalSection keeps the request's frozen-dataclass
            # contract intact.
            prepared_utts, trace = preprocess_section(
                section_id=sec.id,
                section_type=sec.type,
                lyrics=sec.lyrics,
                transliteration=sec.transliteration,
                language=sec.language,
                script=sec.script,
                target_seconds=float(sec.target_seconds),
                tempo_bpm=sec.tempo_bpm,
            )
            cloned = sec
            if sec.phonemes:
                phoneme_str = " ".join(sec.phonemes)
                cloned = replace(
                    sec,
                    transliteration=phoneme_str,
                    script="ipa",
                )
            elif prepared_utts:
                joined_text = " ".join(u.text for u in prepared_utts)
                inferred_script = (
                    prepared_utts[0].script_hint
                    if prepared_utts[0].script_hint
                    else (sec.script or "latin")
                )
                cloned = replace(
                    sec,
                    transliteration=joined_text,
                    script=inferred_script,
                )
            # Trace is recorded via the underlying logger inside
            # preprocess_section; we expose the count on decisions for
            # callers that want a per-section view.
            if trace.utterances_emitted:
                decisions[-1] = RouteDecision(
                    section_id=sec.id,
                    backend=key,
                    reason=(
                        f"{reason}+prepared({trace.utterances_emitted}"
                        f"{'-phon' if sec.phonemes else ''})"
                    ),
                    chant_style_applied=decisions[-1].chant_style_applied,
                )
            backend = self._ensure_backend(key)
            # Each backend renders a one-section sub-request so we can
            # concatenate the per-section outputs without per-backend
            # state leaks.
            sub_req = VocalRequest(
                job_id=req.job_id,
                attempt_id=req.attempt_id,
                trace_id=req.trace_id,
                language=req.language,
                style_family=req.style_family,
                voice_timbre=req.voice_timbre,
                sample_rate=sr,
                sections=[cloned],
                target_duration_seconds=sec.target_seconds,
            )
            sub_wav = backend.synthesise(sub_req)  # type: ignore[attr-defined]
            # Decode the PCM body so we can re-concatenate without
            # nested WAV headers.
            decoded = _decode_wav_mono(sub_wav)
            if use_chant:
                # The chant prosody pass is mass-preserving in peak
                # and length, so we don't need to renormalise here.
                # The LoRA itself shapes pitch + timbre at backend
                # synthesise() time when mounted; this pass is the
                # always-on envelope companion (see chant_style.py).
                decoded = apply_chant_prosody(
                    decoded,
                    spec=self._chant_spec,
                    sample_rate=sr,
                )
                decisions[-1] = RouteDecision(
                    section_id=decisions[-1].section_id,
                    backend=decisions[-1].backend,
                    reason=decisions[-1].reason,
                    chant_style_applied=True,
                )
            chunks.append(decoded)
        self._last_decisions = decisions

        out = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
        target_n = int(req.target_duration_seconds * sr)
        if out.size < target_n:
            out = np.concatenate(
                [out, np.zeros(target_n - out.size, dtype=np.float32)]
            )
        else:
            out = out[:target_n]
        peak = float(np.max(np.abs(out)) or 1.0)
        if peak > 0.95:
            out = out * (0.95 / peak)
        return _write_wav_mono(out, sr)


def _decode_wav_mono(buf: bytes) -> np.ndarray:
    """Reverse of `_write_wav_mono` for a canonical 16-bit mono header."""
    import struct

    assert buf[:4] == b"RIFF"
    assert buf[8:12] == b"WAVE"
    data_size = struct.unpack("<I", buf[40:44])[0]
    pcm = np.frombuffer(buf[44 : 44 + data_size], dtype=np.int16)
    return (pcm.astype(np.float32) / 32767.0).copy()
