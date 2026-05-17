"""HeartMuLa wrapper for `services/music-inference`.

This module is the only place that imports `heartlib`. The wrapper is
designed so that:

* On the **DGX**, `HeartMuLaModel.load()` actually pulls the
  `heartlib.HeartMuLaGenPipeline` into GPU memory.
* On a developer workstation or in CI (no CUDA, no heartlib in the
  venv), `HeartMuLaModel` never has to import heartlib. Tests substitute
  a `FakeMusicModel` via `app.model.set_active_model(...)`.

The request → lyrics/tags translation lives here too, so the FastAPI
layer in `serve.py` stays thin and the prompt-engineering surface has
exactly one home.

References:
* HeartMuLa quickstart -- https://github.com/HeartMuLa/heartlib
* `examples/run_music_generation.py` is the canonical inference script;
  this module reproduces its call signature in-process so the worker
  can avoid `subprocess` overhead and stdin/stdout marshalling.
"""

from __future__ import annotations

import contextlib
import io
import logging
import os
import tempfile
import wave
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Protocol

LOG = logging.getLogger("music-inference.model")

# Public Song Document section types -> heartlib lyric block names.
# Anything we don't recognise falls back to `[Verse]` so we never lose a
# section to an unknown enum.
_SECTION_HEADERS: dict[str, str] = {
    "intro": "[Intro]",
    "verse": "[Verse]",
    "prechorus": "[Prechorus]",
    "pre-chorus": "[Prechorus]",
    "chorus": "[Chorus]",
    "bridge": "[Bridge]",
    "outro": "[Outro]",
    "hook": "[Chorus]",
    "instrumental": "[Verse]",
    "solo": "[Verse]",
    # Carnatic / Hindustani section types from the Song Document schema.
    # We route them to the structural-contrast HeartMuLa tag that gives
    # the closest energy curve: pallavi/mukhda/anupallavi behave like
    # verses + pre-chorus, charanam/antara like verses, alaap like an
    # ambient intro, sargam/folk_refrain like a hook.
    "pallavi": "[Verse]",
    "anupallavi": "[Prechorus]",
    "charanam": "[Verse]",
    "mukhda": "[Verse]",
    "antara": "[Verse]",
    "saranam": "[Verse]",
    "alaap": "[Intro]",
    "sargam": "[Chorus]",
    "folk_refrain": "[Chorus]",
    "folk_stanza": "[Verse]",
    # v1.4 Sprint 2: Sanskrit chant section types (see ADR 0023 R2.5).
    # `shloka_refrain` repeats like a chorus; `shloka_verse` is the
    # successive shloka body; `phalashruti` is the closing fruit-of-
    # recitation verse, which we hand off as an outro for energy decay.
    "shloka_verse": "[Verse]",
    "shloka_refrain": "[Chorus]",
    "phalashruti": "[Outro]",
}


# Mapping from our `style_family` enum to a seed tag set the model
# responds to well. These are merged with per-section tags. The full
# tag vocabulary heartlib expects is comma-separated, no spaces (per
# heartlib README + issue #17), so we strip stray whitespace before
# joining.
_STYLE_TAGS: dict[str, list[str]] = {
    "western": ["pop", "vocal"],
    "carnatic": ["carnatic", "indian-classical", "vocal", "tambura"],
    "hindustani": ["hindustani", "indian-classical", "vocal", "raga"],
    "kannada-folk": ["folk", "kannada", "indian", "acoustic"],
    # v1.3 Sprint 2: bhavageete is sugama-sangeetha (light-classical
    # lyric), not folk; Tamil folk is janapada-dance with parai-driven
    # percussion. Tag sets steer HeartMuLa toward the right register.
    "kannada-light-classical": [
        "light-classical",
        "kannada",
        "bhavageete",
        "vocal",
        "harmonium",
        "tabla",
        "tanpura",
    ],
    "tamil-folk": [
        "folk",
        "tamil",
        "indian",
        "janapada",
        "parai",
        "nadaswaram",
    ],
    # v1.4 Sprint 2: new style families. Tag sets are starting points;
    # Sprint 4 + Sprint 10 will refine them when AudioCraft + the
    # advanced controls land. The conservative bias is to add the
    # *genre*, the *language*, and one or two *instrument* anchors.
    "bollywood-ballad": [
        "bollywood",
        "hindi",
        "ballad",
        "vocal",
        "strings",
        "tabla",
        "harmonium",
    ],
    "sanskrit-shloka": [
        "chant",
        "sanskrit",
        "vedic",
        "devotional",
        "tanpura",
        "harmonium",
    ],
    "bengali-rabindrasangeet": [
        "rabindra-sangeet",
        "bengali",
        "tagore",
        "vocal",
        "harmonium",
        "esraj",
    ],
    "telugu-keerthana": [
        "carnatic",
        "telugu",
        "keerthana",
        "vocal",
        "violin",
        "mridangam",
    ],
}


@dataclass(frozen=True)
class GenerationRequest:
    """Pure-data view of a `/v1/generate` request.

    `serve.py` adapts the FastAPI Pydantic model into this so the model
    layer doesn't depend on FastAPI types.
    """
    job_id: str
    attempt_id: str | None
    style_family: str
    target_duration_seconds: int
    sections: list[GenerationSection]
    tempo_bpm: int | None = None
    time_signature: str | None = None
    tala: str | None = None
    output_format: Literal["wav", "mp3", "flac"] = "wav"
    sample_rate: int = 48000


@dataclass(frozen=True)
class GenerationSection:
    id: str
    type: str
    lyrics: str | None = None
    transliteration: str | None = None
    swara_sequence: str | None = None
    target_seconds: int = 30
    tags: list[str] | None = None


def build_lyrics_block(sections: Iterable[GenerationSection]) -> str:
    """Render a section list into the heartlib lyrics format.

    The model expects blocks like::

        [Intro]

        [Verse]
        line 1
        line 2

        [Chorus]
        ...

    For Indic content we feed `transliteration` if it's present (which
    the Phase-3 lyrics provider always produces) -- HeartMuLa was
    trained on Latin-script lyrics for Indic languages, so the
    transliterated form is the higher-fidelity input.
    """
    out: list[str] = []
    for s in sections:
        header = _SECTION_HEADERS.get(s.type.lower(), "[Verse]")
        body = (s.transliteration or s.lyrics or "").strip()
        out.append(header)
        if body:
            out.append(body)
        out.append("")  # blank line between blocks
    return "\n".join(out).rstrip() + "\n"


def build_tags_block(req: GenerationRequest) -> str:
    """Render the style + per-section tag union for heartlib.

    Format is a single comma-separated line per the heartlib README.
    We dedupe while preserving the first-seen order so the operator
    can reason about which tag the model saw "first".
    """
    seen: set[str] = set()
    out: list[str] = []
    for tag in _STYLE_TAGS.get(req.style_family, []):
        if tag not in seen:
            seen.add(tag)
            out.append(tag)
    for s in req.sections:
        for tag in s.tags or []:
            t = tag.strip()
            if t and t not in seen:
                seen.add(t)
                out.append(t)
    return ",".join(out)


class MusicModel(Protocol):
    """The surface the FastAPI layer talks to.

    Implementations:
    * `HeartMuLaModel` -- production, GPU.
    * `FakeMusicModel` -- tests, returns a deterministic 1s of silence.
    """

    model_loaded: bool
    model_version: str | None

    def generate(self, req: GenerationRequest) -> bytes:
        """Return WAV bytes for the given request. Synchronous on
        purpose: heartlib is itself blocking under `torch.no_grad`.
        FastAPI runs it on a threadpool when called from an async
        endpoint."""
        ...


# --- Production model ------------------------------------------------------


class HeartMuLaModel:
    """Real HeartMuLa pipeline; imports heartlib lazily on `load()`.

    v1.4 Sprint 8: the constructor accepts an optional dict of LoRA
    adapters keyed by style_family (e.g. `{'kannada-light-classical':
    Path('/mnt/models/lora/bhavageete-v1')}`). When `generate()` runs
    with a request whose `style_family` matches a known adapter, the
    adapter is attached on top of the base HeartMuLa pipeline for that
    call and detached afterwards so a follow-up request in a different
    style isn't biased. We attach via `peft.PeftModel.from_pretrained`
    in `_attach_adapter`, mirroring the Sprint 7 IndicBART path.
    """

    def __init__(
        self,
        ckpt_dir: Path,
        *,
        version: str = "3B",
        mula_device: str = "cuda",
        codec_device: str = "cuda",
        mula_dtype: str = "bfloat16",
        codec_dtype: str = "float32",
        lazy_load: bool = False,
        topk: int = 50,
        temperature: float = 1.0,
        cfg_scale: float = 1.5,
        style_adapters: dict[str, Path] | None = None,
    ) -> None:
        self.ckpt_dir = ckpt_dir
        self.version = version
        self._mula_device = mula_device
        self._codec_device = codec_device
        self._mula_dtype = mula_dtype
        self._codec_dtype = codec_dtype
        self._lazy_load = lazy_load
        self._topk = topk
        self._temperature = temperature
        self._cfg_scale = cfg_scale
        self._pipe: Any = None
        self.model_loaded: bool = False
        self.model_version: str | None = None
        # adapter registry: style_family -> on-disk path. The actual
        # PEFT load happens lazily inside `_attach_adapter` so a missing
        # adapter directory only errors when that style is requested.
        self._style_adapters: dict[str, Path] = dict(style_adapters or {})
        # cache of loaded adapter names so we don't re-load on every
        # request — `peft` keeps adapters resident once registered.
        self._loaded_adapter_names: set[str] = set()

    def load(self) -> None:
        """Eager-load weights into GPU memory (TRIZ C2: first user
        request must not pay the cold-start tax)."""
        # Lazy imports so test environments without CUDA/heartlib still
        # exercise everything else in this module.
        import torch  # type: ignore[import-not-found]
        from heartlib import HeartMuLaGenPipeline  # type: ignore[import-not-found]

        if not self.ckpt_dir.exists():
            raise RuntimeError(
                f"HEARTMULA_CKPT_DIR={self.ckpt_dir} does not exist. "
                "Run scripts/download-heartmula.py first."
            )

        dtype_map = {"float32": torch.float32, "bfloat16": torch.bfloat16, "float16": torch.float16}
        LOG.info(
            "loading HeartMuLa",
            extra={"extra_fields": {"ckpt_dir": str(self.ckpt_dir), "version": self.version}},
        )
        self._pipe = HeartMuLaGenPipeline.from_pretrained(
            str(self.ckpt_dir),
            device={
                "mula": torch.device(self._mula_device),
                "codec": torch.device(self._codec_device),
            },
            dtype={
                "mula": dtype_map[self._mula_dtype],
                "codec": dtype_map[self._codec_dtype],
            },
            version=self.version,
            lazy_load=self._lazy_load,
        )
        self.model_loaded = True
        self.model_version = f"heartmula-oss-{self.version}-happy-new-year"
        LOG.info(
            "HeartMuLa loaded",
            extra={
                "extra_fields": {
                    "style_adapters": sorted(self._style_adapters.keys()),
                }
            },
        )

    def has_adapter_for(self, style_family: str) -> bool:
        """True if a LoRA adapter is registered for this style."""
        return style_family in self._style_adapters

    def adapter_name_for(self, style_family: str) -> str:
        """Stable adapter name used by PEFT; e.g.
        `kannada-light-classical` -> `bhavageete_v1` (or just the style)
        — the path's directory name is the canonical identifier."""
        path = self._style_adapters[style_family]
        return path.name or style_family

    def _attach_adapter(self, style_family: str) -> str | None:
        """Attach the LoRA adapter for `style_family` if registered.

        Returns the active adapter name, or `None` if no adapter is
        registered for the style. The base HeartMuLa weights are
        untouched; PEFT wraps the inner causal LM (the `mula` half of
        the pipeline) with an adapter that activates only when its
        name is set.

        We import `peft` lazily so the CI/dev path that uses
        `FakeMusicModel` never has to pull torch.
        """
        path = self._style_adapters.get(style_family)
        if path is None:
            return None
        if not path.exists():
            raise RuntimeError(
                f"LoRA adapter directory for style_family={style_family!r} "
                f"does not exist on disk: {path}. Run "
                f"`scripts/download-heartmula-adapters.py` or `train_*_lora.py "
                f"--push-to-hub` and pull the adapter."
            )

        adapter_name = self.adapter_name_for(style_family)
        # The pipeline exposes its trainable LM under `.mula`; mirror the
        # heartlib structure. If a future heartlib release moves this, we
        # raise a clearer error than `AttributeError`.
        if not hasattr(self._pipe, "mula"):
            raise RuntimeError(
                "HeartMuLa pipeline has no `.mula` attribute; cannot "
                "attach a LoRA adapter. heartlib upgrade may have moved "
                "the inner LM."
            )
        inner = self._pipe.mula
        if adapter_name not in self._loaded_adapter_names:
            if hasattr(inner, "load_adapter"):
                # Mula is already a PeftModel — just add this adapter to
                # its registry. This is the path heartlib + peft give us
                # when the base model was wrapped at startup.
                inner.load_adapter(str(path), adapter_name=adapter_name)
            else:
                # First time we're wrapping mula with peft. Lazy-import
                # so CI/dev (which uses FakeMusicModel) never has to
                # pull `peft`.
                from peft import PeftModel  # type: ignore[import-not-found]

                self._pipe.mula = PeftModel.from_pretrained(
                    inner, str(path), adapter_name=adapter_name
                )
            self._loaded_adapter_names.add(adapter_name)
        # Activate this adapter for the forthcoming generate() call.
        if hasattr(self._pipe.mula, "set_adapter"):
            self._pipe.mula.set_adapter(adapter_name)
        return adapter_name

    def _detach_adapter(self) -> None:
        """Disable any active LoRA adapter so the next request — which
        might be a different style — sees the unbiased base model.

        We call `disable_adapter()` if available; PEFT's
        `disable_adapter` is a context manager *and* a method on
        recent versions, so we try the method form first.
        """
        if self._pipe is None or not hasattr(self._pipe, "mula"):
            return
        inner = self._pipe.mula
        if hasattr(inner, "disable_adapters"):
            try:
                inner.disable_adapters()
            except Exception:  # pragma: no cover - depends on peft version
                LOG.warning("failed to disable LoRA adapter")

    def generate(self, req: GenerationRequest) -> bytes:
        if not self.model_loaded or self._pipe is None:
            raise RuntimeError("HeartMuLaModel.generate called before load()")

        import torch

        lyrics_text = build_lyrics_block(req.sections)
        tags_text = build_tags_block(req)
        max_ms = req.target_duration_seconds * 1000

        # v1.4 Sprint 8: attach the per-style LoRA if registered. The
        # adapter activates only for this request — we detach in the
        # `finally` so concurrent calls in different styles can't bleed
        # into each other.
        active_adapter = self._attach_adapter(req.style_family)
        try:
            # heartlib takes file paths for lyrics/tags and writes the
            # rendered audio to disk. Stage in a tempdir so two concurrent
            # requests can't collide.
            with tempfile.TemporaryDirectory(prefix="heartmula-") as workdir:
                wd = Path(workdir)
                lyrics_path = wd / "lyrics.txt"
                tags_path = wd / "tags.txt"
                out_path = wd / f"output.{req.output_format}"
                lyrics_path.write_text(lyrics_text, encoding="utf-8")
                tags_path.write_text(tags_text, encoding="utf-8")

                with torch.no_grad():
                    self._pipe(
                        {"lyrics": str(lyrics_path), "tags": str(tags_path)},
                        max_audio_length_ms=max_ms,
                        save_path=str(out_path),
                        topk=self._topk,
                        temperature=self._temperature,
                        cfg_scale=self._cfg_scale,
                    )

                audio = out_path.read_bytes()
        finally:
            if active_adapter is not None:
                self._detach_adapter()

        # heartlib may write either wav or mp3 depending on the path
        # extension. If the client wanted wav but we ended up with
        # something else, transcode to WAV via soundfile (CPU, cheap
        # next to inference).
        if req.output_format == "wav" and not _looks_like_wav(audio):
            audio = _transcode_to_wav(audio, sample_rate=req.sample_rate)
        return audio


# --- Test double ----------------------------------------------------------


class FakeMusicModel:
    """Deterministic in-memory model for tests.

    `generate()` returns a 100ms 48kHz mono PCM-16 WAV containing
    silence, so happy-path tests can assert "the bytes look like a WAV"
    without needing torch or heartlib.
    """

    def __init__(self, version: str = "fake-1.0") -> None:
        self.model_loaded: bool = True
        self.model_version: str | None = version
        self.last_request: GenerationRequest | None = None
        self.last_lyrics: str | None = None
        self.last_tags: str | None = None

    def generate(self, req: GenerationRequest) -> bytes:
        self.last_request = req
        self.last_lyrics = build_lyrics_block(req.sections)
        self.last_tags = build_tags_block(req)
        return _silent_wav(duration_seconds=0.1, sample_rate=req.sample_rate or 48000)


# --- Helpers --------------------------------------------------------------


def _silent_wav(*, duration_seconds: float, sample_rate: int = 48000) -> bytes:
    n = int(sample_rate * duration_seconds)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)  # PCM-16
        w.setframerate(sample_rate)
        w.writeframes(b"\x00\x00" * n)
    return buf.getvalue()


def _looks_like_wav(blob: bytes) -> bool:
    return len(blob) >= 12 and blob[0:4] == b"RIFF" and blob[8:12] == b"WAVE"


def _transcode_to_wav(blob: bytes, *, sample_rate: int) -> bytes:
    """Decode any soundfile-recognised format into PCM-16 WAV.

    Imported lazily so this stays optional in CI; the heartlib output
    on the DGX should already be one of soundfile's supported formats
    (wav/flac directly; mp3 via libsndfile 1.2+).
    """
    import numpy as np  # type: ignore[import-not-found]
    import soundfile as sf  # type: ignore[import-not-found]

    with io.BytesIO(blob) as src:
        data, sr = sf.read(src, dtype="int16", always_2d=False)
    out = io.BytesIO()
    sf.write(
        out,
        data if isinstance(data, np.ndarray) else np.asarray(data, dtype=np.int16),
        samplerate=sr,
        format="WAV",
        subtype="PCM_16",
    )
    return out.getvalue()


# --- Module-level singleton + test seam -----------------------------------


# v1.4 Sprint 8: per-style LoRA adapter discovery from env. The mapping
# from `style_family` to env-var follows the pattern
# `HEARTMULA_LORA_<STYLE>` with `-` -> `_` capitalised, e.g.
# `HEARTMULA_LORA_KANNADA_LIGHT_CLASSICAL=/mnt/models/lora/bhavageete-v1`.
# Unknown styles are ignored — the env-var is the source of truth, but
# only style_families we know about (the SongDocument enum) can ever be
# requested at runtime, so this is a no-op in practice.
_STYLE_ADAPTER_ENV: dict[str, str] = {
    "western": "HEARTMULA_LORA_WESTERN",
    "carnatic": "HEARTMULA_LORA_CARNATIC",
    "hindustani": "HEARTMULA_LORA_HINDUSTANI",
    "kannada-folk": "HEARTMULA_LORA_KANNADA_FOLK",
    "kannada-light-classical": "HEARTMULA_LORA_KANNADA_LIGHT_CLASSICAL",
    "tamil-folk": "HEARTMULA_LORA_TAMIL_FOLK",
    "bollywood-ballad": "HEARTMULA_LORA_BOLLYWOOD_BALLAD",
    "sanskrit-shloka": "HEARTMULA_LORA_SANSKRIT_SHLOKA",
    "bengali-rabindrasangeet": "HEARTMULA_LORA_BENGALI_RABINDRASANGEET",
    "telugu-keerthana": "HEARTMULA_LORA_TELUGU_KEERTHANA",
}


def _style_adapters_from_env() -> dict[str, Path]:
    out: dict[str, Path] = {}
    for style, env_var in _STYLE_ADAPTER_ENV.items():
        value = os.environ.get(env_var)
        if not value:
            continue
        out[style] = Path(value)
    return out


_active_model: MusicModel | None = None


def set_active_model(model: MusicModel | None) -> None:
    """Install a model (tests use this; production calls it once at
    startup with the real `HeartMuLaModel`)."""
    global _active_model
    _active_model = model


def get_active_model() -> MusicModel | None:
    return _active_model


def initialise_from_env() -> MusicModel:
    """Build the model the env asks for. Called from the FastAPI
    startup event handler.

    * `MUSIC_INFERENCE_FAKE_MODEL=1` -> install `FakeMusicModel` and
      skip GPU entirely. Lets the operator bring the container up
      without weights and confirm the rest of the stack works. **Refused
      unless `MUSIC_INFERENCE_ALLOW_FAKE=1` is also set**, so a stray
      env-var inheritance can never silently ship deterministic silence
      to real users.
    * else -> build a real `HeartMuLaModel`. `load()` is run eagerly
      unless `HEARTMULA_LAZY_LOAD=1`.
    """
    if os.environ.get("MUSIC_INFERENCE_FAKE_MODEL") == "1":
        if os.environ.get("MUSIC_INFERENCE_ALLOW_FAKE") != "1":
            # We do not raise from a config issue silently. A startup
            # crash with a loud line is the desired outcome here -- it
            # surfaces in `docker compose up` immediately and prevents
            # the container from accepting traffic while pretending to
            # have a model loaded.
            raise RuntimeError(
                "MUSIC_INFERENCE_FAKE_MODEL=1 was set but "
                "MUSIC_INFERENCE_ALLOW_FAKE=1 was not. Refusing to "
                "install FakeMusicModel: this would serve deterministic "
                "silence in place of generated audio. Set both env vars "
                "to opt in (intended for CI and local smoke tests only)."
            )
        LOG.warning(
            "MUSIC_INFERENCE_FAKE_MODEL=1 + MUSIC_INFERENCE_ALLOW_FAKE=1 "
            "-- serving deterministic silence (CI/test mode)"
        )
        model: MusicModel = FakeMusicModel()
        set_active_model(model)
        return model

    ckpt_dir = Path(os.environ.get("HEARTMULA_CKPT_DIR", "/mnt/models/heartmula"))
    real = HeartMuLaModel(
        ckpt_dir=ckpt_dir / "ckpt",  # see scripts/download-heartmula.py layout
        version=os.environ.get("HEARTMULA_VERSION", "3B"),
        mula_device=os.environ.get("HEARTMULA_MULA_DEVICE", "cuda"),
        codec_device=os.environ.get("HEARTMULA_CODEC_DEVICE", "cuda"),
        mula_dtype=os.environ.get("HEARTMULA_MULA_DTYPE", "bfloat16"),
        codec_dtype=os.environ.get("HEARTMULA_CODEC_DTYPE", "float32"),
        lazy_load=os.environ.get("HEARTMULA_LAZY_LOAD") == "1",
        topk=int(os.environ.get("HEARTMULA_TOPK", "50")),
        temperature=float(os.environ.get("HEARTMULA_TEMPERATURE", "1.0")),
        cfg_scale=float(os.environ.get("HEARTMULA_CFG_SCALE", "1.5")),
        style_adapters=_style_adapters_from_env(),
    )
    if os.environ.get("HEARTMULA_DEFER_LOAD") != "1":
        real.load()

    # v1.4 Sprint 10: optionally wire in MusicGen as a second backend
    # behind `RoutingMusicModel`. The flag is off by default so dev and
    # CI environments (no AudioCraft, no GPU) don't accidentally pull
    # MusicGen weights. On the DGX the operator flips
    # `MUSIC_INFERENCE_ENABLE_MUSICGEN=1` after running
    # `scripts/download-musicgen.py`.
    if os.environ.get("MUSIC_INFERENCE_ENABLE_MUSICGEN") == "1":
        from app.musicgen_model import MusicGenModel, style_adapters_from_env
        from app.routing import RoutingMusicModel

        mg = MusicGenModel(
            device=os.environ.get("MUSICGEN_DEVICE", "cuda"),
            dtype=os.environ.get("MUSICGEN_DTYPE", "bfloat16"),
            weights_repo=os.environ.get(
                "MUSICGEN_REPO", "facebook/musicgen-medium"
            ),
            style_adapters=style_adapters_from_env(),
        )
        if os.environ.get("MUSICGEN_DEFER_LOAD") != "1":
            mg.load()
        routed: MusicModel = RoutingMusicModel(heartmula=real, musicgen=mg)
        set_active_model(routed)
        return routed

    set_active_model(real)
    return real


@contextlib.contextmanager
def override_model(model: MusicModel) -> Iterator[MusicModel]:
    """Test helper: swap the active model for the duration of a `with` block."""
    previous = get_active_model()
    try:
        set_active_model(model)
        yield model
    finally:
        set_active_model(previous)
