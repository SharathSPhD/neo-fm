"""
`ParlerTTSModel`: Indic Parler-TTS backend (Sprint D, ADR 0020).

Parler-TTS (`ai4bharat/indic-parler-tts`) supports natural-language
voice descriptors (e.g. "Aditi, a young woman, calm, slow pace, clear
diction") and produces 24 kHz output. We expose it as a sibling to
`SvaraTTSModel`; the routing model (`routing.py`) picks between them
per utterance based on language + script.

The class deliberately mirrors `SvaraTTSModel.synthesise` and uses the
same `VocalRequest` shape so the rest of the service is oblivious to
which backend ran. All heavy imports (torch / transformers) stay
inside `load()` so importing this module is cheap for the unit tests.
"""

from __future__ import annotations

import os
from typing import Literal

import numpy as np

from .model import VocalRequest, _write_wav_mono
from .voice_catalog import get_voice


_DEFAULT_VOICE_DESCRIPTOR = (
    "A calm, expressive Indian voice, clear diction, "
    "natural breath, suitable for melodic singing."
)


def voice_descriptor(
    *,
    voice_timbre: Literal["male", "female", "androgynous"],
    style_family: str,
    raga_name: str | None,
    voice_prompt: str | None = None,
) -> str:
    """Build a Parler voice descriptor string.

    Parler's prompt format is "<voice description>. <text>". The
    voice description influences pitch register, breathiness, and
    pacing. We tailor it to the song style so a Carnatic kriti gets
    a different vibe from a Bollywood ballad.

    (v1.4 Sprint 5) When the caller supplies an explicit
    ``voice_prompt`` (resolved from the catalogue in ``routing.py``),
    we *prefer* it as the base voice description and only append the
    style/raga adornment. That way each persona keeps its identity
    across styles, but a "warm Kannada male" still ornaments
    differently when sung in a Carnatic vs Bhavageete context.
    """
    if voice_prompt:
        # The catalogue already encodes timbre/register/persona, so
        # don't double up with `timbre_phrase`. We *do* keep the
        # style and raga adornment because the catalogue entry is
        # style-agnostic on purpose.
        if style_family == "carnatic":
            adornment = ", ornamented gamakas, devotional"
        elif style_family == "hindustani":
            adornment = ", legato sustains, meditative"
        elif style_family == "kannada-folk":
            adornment = ", rural folk character, lively"
        elif style_family == "kannada-light-classical":
            adornment = ", gentle melismas, lyric phrasing, sugama-sangeetha"
        elif style_family == "tamil-folk":
            adornment = ", percussive call-and-response, parai energy"
        elif style_family == "bollywood-ballad":
            adornment = ", cinematic ballad phrasing, lush"
        elif style_family == "sanskrit-shloka":
            adornment = ", slow sustained chant, meditative"
        elif style_family == "bengali-rabindrasangeet":
            adornment = ", deliberate vibrato, Rabindrasangeet phrasing"
        elif style_family == "telugu-keerthana":
            adornment = ", devotional Carnatic keerthana phrasing"
        else:
            adornment = ", contemporary pop polish"
        raga_phrase = f", performing in raga {raga_name}" if raga_name else ""
        prompt = voice_prompt.strip()
        if prompt.endswith("."):
            prompt = prompt[:-1]
        return f"{prompt}{adornment}{raga_phrase}, clear diction, natural breath."
    timbre_phrase = {
        "male": "A male vocalist with warm chest tone",
        "female": "A female vocalist with bright, expressive timbre",
        "androgynous": "An androgynous vocalist with rich middle register",
    }.get(voice_timbre, "An expressive vocalist")
    if style_family == "carnatic":
        adornment = ", ornamented gamakas, devotional"
    elif style_family == "hindustani":
        adornment = ", legato sustains, meditative"
    elif style_family == "kannada-folk":
        adornment = ", rural folk character, lively"
    elif style_family == "kannada-light-classical":
        # bhavageete: poem-set-to-frame; gentle ornaments, lyric phrasing.
        adornment = ", gentle melismas, lyric phrasing, sugama-sangeetha"
    elif style_family == "tamil-folk":
        adornment = ", percussive call-and-response, parai energy"
    elif style_family == "bollywood-ballad":
        adornment = ", cinematic ballad phrasing, lush"
    elif style_family == "sanskrit-shloka":
        adornment = ", slow sustained chant, meditative"
    elif style_family == "bengali-rabindrasangeet":
        adornment = ", deliberate vibrato, Rabindrasangeet phrasing"
    elif style_family == "telugu-keerthana":
        adornment = ", devotional Carnatic keerthana phrasing"
    else:
        adornment = ", contemporary pop polish"
    raga_phrase = f", performing in raga {raga_name}" if raga_name else ""
    return f"{timbre_phrase}{adornment}{raga_phrase}, clear diction, natural breath."


class ParlerTTSModel:
    """Indic Parler-TTS backend. Mirrors SvaraTTSModel surface."""

    def __init__(self, model_id: str = "ai4bharat/indic-parler-tts") -> None:
        self._model_id = model_id
        self._loaded = False
        self._model: object | None = None
        self._tokenizer: object | None = None
        self._description_tokenizer: object | None = None
        self._device: str = "cpu"

    @property
    def model_loaded(self) -> bool:
        return self._loaded

    @property
    def model_version(self) -> str | None:
        return self._model_id if self._loaded else None

    def load(self) -> None:
        if self._loaded:
            return
        import torch  # type: ignore[import-not-found]
        from huggingface_hub import snapshot_download  # type: ignore[import-not-found]
        from transformers import (  # type: ignore[import-not-found]
            AutoTokenizer,
        )

        # Parler-TTS specific model class. Defer import inside load() so
        # tests can stub the backend without parler_tts installed.
        try:
            from parler_tts import ParlerTTSForConditionalGeneration  # type: ignore[import-not-found]
        except ImportError as e:  # pragma: no cover - depends on optional dep
            raise RuntimeError(
                "parler_tts is not installed. "
                "Add `parler_tts` to vocal-synth requirements when enabling the Parler backend."
            ) from e

        cache_dir = os.environ.get("HF_HOME") or os.environ.get(
            "HUGGINGFACE_HUB_CACHE"
        )
        local_path = snapshot_download(
            self._model_id,
            cache_dir=cache_dir,
            local_files_only=os.environ.get("NEO_FM_OFFLINE", "0") == "1",
        )
        self._device = (
            "cuda"
            if torch.cuda.is_available()
            else "mps"
            if getattr(torch.backends, "mps", None)
            and torch.backends.mps.is_available()
            else "cpu"
        )
        # Two tokenizers: one for the voice description, one for the
        # text to be sung. Parler-TTS docs call them out separately.
        self._description_tokenizer = AutoTokenizer.from_pretrained(local_path)
        self._tokenizer = AutoTokenizer.from_pretrained(local_path)
        self._model = (
            ParlerTTSForConditionalGeneration.from_pretrained(local_path)
            .to(self._device)
            .eval()
        )
        self._loaded = True

    def synthesise(self, req: VocalRequest) -> bytes:
        if not self._loaded:
            raise RuntimeError("ParlerTTSModel.load() not called")
        import torch  # type: ignore[import-not-found]

        sr = req.sample_rate
        chunks: list[np.ndarray] = []
        with torch.inference_mode():
            for sec in req.sections:
                if sec.type == "instrumental" or not (
                    sec.lyrics or sec.transliteration
                ):
                    chunks.append(
                        np.zeros(int(sec.target_seconds * sr), dtype=np.float32)
                    )
                    continue
                text = sec.transliteration or sec.lyrics or ""
                # v1.4 Sprint 5: when a section carries a catalogue
                # voice_id, look up the prompt and feed it to the
                # descriptor builder. Unknown ids fall through to
                # the legacy timbre/style descriptor.
                voice_entry = get_voice(sec.voice_id)
                description = voice_descriptor(
                    voice_timbre=req.voice_timbre,
                    style_family=req.style_family,
                    raga_name=sec.raga_name,
                    voice_prompt=voice_entry.prompt if voice_entry else None,
                )
                desc_inputs = self._description_tokenizer(  # type: ignore[union-attr]
                    description,
                    return_tensors="pt",
                ).to(self._device)
                txt_inputs = self._tokenizer(  # type: ignore[union-attr]
                    text,
                    return_tensors="pt",
                ).to(self._device)
                generation = self._model.generate(  # type: ignore[union-attr]
                    input_ids=desc_inputs.input_ids,
                    prompt_input_ids=txt_inputs.input_ids,
                )
                stem = (
                    generation.cpu().numpy().squeeze().astype(np.float32)
                )
                src_sr = getattr(self._model.config, "sampling_rate", sr)  # type: ignore[union-attr]
                if src_sr != sr and stem.size > 0:
                    ratio = sr / src_sr
                    new_n = int(stem.size * ratio)
                    idx = np.linspace(0, stem.size - 1, new_n).astype(np.int64)
                    stem = stem[idx]
                target_n = int(sec.target_seconds * sr)
                if stem.size < target_n:
                    stem = np.concatenate(
                        [stem, np.zeros(target_n - stem.size, dtype=np.float32)]
                    )
                else:
                    stem = stem[:target_n]
                chunks.append(stem)
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
