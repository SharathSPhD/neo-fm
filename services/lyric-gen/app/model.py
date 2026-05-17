"""
Lyric-gen model layer.

`LyricGenModel` is a Protocol so tests can substitute `FakeLyricGenModel`.
Two backends are wired:

  - **indicbart** : `ai4bharat/IndicBART` with the SFT adapter
                    `neo-fm/lyric-gen-indicbart-v1` (trained on DGX).
                    Default in prod once the adapter is uploaded.
  - **fake**      : deterministic offline backend that templates a
                    reproducible stanza based on `(style_family,
                    language, syllable_count)` so CI doesn't need
                    transformers / torch. Good enough for the worker
                    integration smoke and for `pnpm e2e` runs.

If `transformers` isn't importable (CI / docker-compose), the service
falls back to `FakeLyricGenModel` so the container always reaches a
"loaded" state — the worker's lyric-gen feature flag stays the
authoritative kill-switch.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field
from typing import Literal, Protocol


Backend = Literal["indicbart", "fake"]

# Mirrors @neo-fm/song-doc Language union. Keep in sync with
# packages/song-doc/src/index.ts:LanguageSchema.
Language = Literal["en", "hi", "kn", "ta", "te", "bn", "sa"]

# Mirrors @neo-fm/song-doc StyleFamily union. Keep in sync.
StyleFamily = Literal[
    "western",
    "carnatic",
    "hindustani",
    "kannada-folk",
    "kannada-light-classical",
    "tamil-folk",
    "bollywood-ballad",
    "bengali-rabindrasangeet",
    "telugu-keerthana",
    "sanskrit-shloka",
]


@dataclass(frozen=True)
class LyricGenSection:
    """One section the caller wants populated.

    `section_id` mirrors `Section.id` from `@neo-fm/song-doc` so the
    worker can stitch the generated stanza back into the SongDocument
    without an extra match-by-index step. `target_syllables` is a soft
    constraint the model is asked to satisfy.
    """

    section_id: str
    section_type: str
    target_syllables: int


@dataclass(frozen=True)
class LyricGenRequest:
    """One lyric-generation request.

    Mirrors the inputs the IndicBART SFT was trained on. The model
    sees a structured prompt; the eval loop measures syllable-count
    accuracy and G2P round-trip cleanliness.
    """

    job_id: str
    attempt_id: str | None
    trace_id: str | None
    language: Language
    style_family: StyleFamily
    mood: str | None
    prompt: str
    sections: list[LyricGenSection] = field(default_factory=list)
    raga_name: str | None = None
    seed: int | None = None


@dataclass(frozen=True)
class LyricGenSectionResult:
    section_id: str
    lyrics: str
    syllable_count_target: int
    syllable_count_actual: int


@dataclass(frozen=True)
class LyricGenResponse:
    """Result of one lyric-gen invocation."""

    body: str
    sections: list[LyricGenSectionResult]
    model_version: str
    backend: Backend
    decode_params: dict[str, float | int | str | bool]


class LyricGenModel(Protocol):
    """Backend returns a structured lyric response."""

    @property
    def backend(self) -> Backend: ...

    @property
    def model_loaded(self) -> bool: ...

    @property
    def model_version(self) -> str | None: ...

    def generate(self, req: LyricGenRequest) -> LyricGenResponse: ...


# ---------------------------------------------------------------------------
# Fake backend (always importable)
# ---------------------------------------------------------------------------


_FAKE_TEMPLATES: dict[StyleFamily, list[str]] = {
    "western": [
        "Through the dim and quiet places we have known,",
        "Walking softly toward a light that is not our own,",
    ],
    "carnatic": [
        "Sri-rama jaya rama jaya jaya rama",
        "Anata-sayana karunamaya",
    ],
    "hindustani": [
        "Saanjh dhaley man pyaasa,",
        "Tum bin koi nahi aasa",
    ],
    "kannada-folk": [
        "Hennina nudi keluvave,",
        "Maleya hani thanduvave",
    ],
    "kannada-light-classical": [
        "Mungaaru maleye, ninna sniggdha haadu,",
        "Yaava raagada, neelda jiivanada paatha"
    ],
    "tamil-folk": [
        "Parai murasu adicha,",
        "Kaattukkulla kondaadu"
    ],
    "bollywood-ballad": [
        "Tujhse milkar yeh saans theheri,",
        "Tere bina yeh raat andheri"
    ],
    "bengali-rabindrasangeet": [
        "Aakash bhora surjo tara,",
        "Bishwa bhora pran"
    ],
    "telugu-keerthana": [
        "Sri Rama-chandra nannu kavavayya,",
        "Karuna-rasa-paripoorna"
    ],
    "sanskrit-shloka": [
        "Vande sarasvati devim",
        "Sharadam-bhaja-sakhi-namah"
    ],
}


class FakeLyricGenModel:
    """Deterministic offline backend.

    Picks a 1-2 line template by `style_family`, joins enough copies
    of it to hit the requested syllable count (approximately), and
    returns the same bytes for the same `(style_family, seed, target)`.
    """

    backend: Backend = "fake"
    model_loaded: bool = True
    model_version: str | None = "fake-lyric-gen-0.1.0"

    def generate(self, req: LyricGenRequest) -> LyricGenResponse:
        templates = _FAKE_TEMPLATES.get(req.style_family) or _FAKE_TEMPLATES["western"]
        rng_basis = f"{req.style_family}|{req.language}|{req.seed or 0}".encode()
        digest = hashlib.sha256(rng_basis).digest()
        # Deterministic pick of the leading template.
        head = templates[digest[0] % len(templates)]

        section_results: list[LyricGenSectionResult] = []
        body_chunks: list[str] = []
        for i, section in enumerate(req.sections):
            # Repeat the template line until we're within +/-30% of the
            # requested syllable count. Rough approximation — the real
            # IndicBART backend hits the target much more tightly.
            line = head
            tries = 0
            while _approx_syllables(line) < int(section.target_syllables * 0.85) and tries < 16:
                line = f"{line}\n{head}"
                tries += 1
            actual = _approx_syllables(line)
            section_results.append(
                LyricGenSectionResult(
                    section_id=section.section_id,
                    lyrics=line,
                    syllable_count_target=section.target_syllables,
                    syllable_count_actual=actual,
                )
            )
            body_chunks.append(f"[{section.section_type}]\n{line}")
            # Rotate template per section so the body isn't a single repeat.
            head = templates[(digest[i % len(digest)] + i) % len(templates)]

        body = "\n\n".join(body_chunks)
        return LyricGenResponse(
            body=body,
            sections=section_results,
            model_version=self.model_version or "fake-lyric-gen-0.1.0",
            backend="fake",
            decode_params={"templated": True, "seed": int(req.seed or 0)},
        )


def _approx_syllables(text: str) -> int:
    """Conservative syllable approximator.

    Cheap, language-agnostic: counts vowel-cluster transitions in the
    Latin/Romanised rendering of the line. The real IndicBART backend
    uses `@neo-fm/g2p` for accurate counts; this is only for the fake
    backend's syllable-targeting loop. Underestimates Indic syllables
    slightly because diacritics aren't analysed.
    """
    vowels = set("aeiouyAEIOUYɑəɛɪɔʊ")
    count = 0
    in_vowel = False
    for ch in text:
        if ch in vowels:
            if not in_vowel:
                count += 1
            in_vowel = True
        else:
            in_vowel = False
    # At minimum one syllable per non-blank line so multi-line stanzas
    # don't read as zero-syllable.
    return max(count, sum(1 for line in text.splitlines() if line.strip()))


# ---------------------------------------------------------------------------
# Real backend (deferred imports)
# ---------------------------------------------------------------------------


class _IndicBARTBackend:
    """IndicBART SFT adapter inference backend.

    Loaded lazily — `transformers` is in the `training` extra and
    isn't installed in CI / docker-compose. Operators run
    `uv sync --extra training` on the DGX before launching this in
    prod.
    """

    backend: Backend = "indicbart"

    def __init__(self, model_id_or_path: str, adapter_id: str | None) -> None:
        self._model_id = model_id_or_path
        self._adapter_id = adapter_id
        self._model: object | None = None
        self._tokenizer: object | None = None
        self._model_version: str | None = None

    @property
    def model_loaded(self) -> bool:
        return self._model is not None and self._tokenizer is not None

    @property
    def model_version(self) -> str | None:
        return self._model_version

    def load(self) -> None:
        # Imported lazily; CI / tests never hit this branch.
        import torch  # type: ignore[import-not-found]
        from transformers import (  # type: ignore[import-not-found]
            AutoModelForSeq2SeqLM,
            AutoTokenizer,
        )

        tok = AutoTokenizer.from_pretrained(self._model_id, use_fast=False)
        model = AutoModelForSeq2SeqLM.from_pretrained(
            self._model_id,
            torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
        )
        if self._adapter_id:
            # Lazy PEFT import — only present in the training extra.
            from peft import PeftModel  # type: ignore[import-not-found]

            model = PeftModel.from_pretrained(model, self._adapter_id)
        if torch.cuda.is_available():
            model = model.to("cuda")
        else:
            model = model.to("cpu")
        model.eval()
        self._tokenizer = tok
        self._model = model
        self._model_version = self._adapter_id or self._model_id

    def generate(self, req: LyricGenRequest) -> LyricGenResponse:
        if self._model is None or self._tokenizer is None:
            raise RuntimeError("backend not loaded")
        import torch  # type: ignore[import-not-found]

        prompt = _format_prompt(req)
        inputs = self._tokenizer(  # type: ignore[operator]
            prompt,
            return_tensors="pt",
            truncation=True,
            max_length=512,
        )
        device = "cuda" if torch.cuda.is_available() else "cpu"
        inputs = {k: v.to(device) for k, v in inputs.items()}
        gen_kwargs = {
            "max_new_tokens": 256,
            "num_beams": 1,
            "do_sample": True,
            "temperature": 0.9,
            "top_p": 0.95,
        }
        if req.seed is not None:
            torch.manual_seed(int(req.seed))
        out = self._model.generate(**inputs, **gen_kwargs)  # type: ignore[attr-defined]
        text = self._tokenizer.decode(out[0], skip_special_tokens=True)  # type: ignore[attr-defined]
        # Post-process: split into one chunk per section by the
        # section-header tokens we conditioned on at train time.
        section_results = _split_by_sections(text, req)
        body = "\n\n".join(
            f"[{r.section_id}]\n{r.lyrics}" for r in section_results
        )
        return LyricGenResponse(
            body=body,
            sections=section_results,
            model_version=self._model_version or self._model_id,
            backend="indicbart",
            decode_params=gen_kwargs,
        )


def _format_prompt(req: LyricGenRequest) -> str:
    """Render the SFT-time prompt template.

    Must match `scripts/prepare_dataset.py:format_example` byte-for-byte
    so the trained adapter sees the distribution it was trained on.
    """
    section_spec = "; ".join(
        f"{s.section_type}({s.target_syllables})" for s in req.sections
    )
    return (
        f"<2{req.language}> "
        f"style={req.style_family} "
        f"mood={req.mood or 'neutral'} "
        f"raga={req.raga_name or 'unset'} "
        f"sections={section_spec} | "
        f"{req.prompt}"
    )


def _split_by_sections(
    text: str, req: LyricGenRequest
) -> list[LyricGenSectionResult]:
    """Best-effort split of model output back into per-section stanzas.

    The training format wraps each stanza in `<section id>...</section>`.
    If the adapter respects that, we extract by tag. Otherwise we fall
    back to splitting on blank lines and zip-padding to the requested
    section list.
    """
    import re

    pattern = re.compile(r"<section\s+([a-z0-9_\-]+)>(.*?)</section>", re.DOTALL)
    matches = pattern.findall(text)
    if matches:
        by_id = {sid.strip(): body.strip() for sid, body in matches}
        return [
            LyricGenSectionResult(
                section_id=s.section_id,
                lyrics=by_id.get(s.section_id, ""),
                syllable_count_target=s.target_syllables,
                syllable_count_actual=_approx_syllables(by_id.get(s.section_id, "")),
            )
            for s in req.sections
        ]
    # Fallback: blank-line split.
    chunks = [c.strip() for c in text.split("\n\n") if c.strip()]
    out: list[LyricGenSectionResult] = []
    for i, s in enumerate(req.sections):
        body = chunks[i] if i < len(chunks) else ""
        out.append(
            LyricGenSectionResult(
                section_id=s.section_id,
                lyrics=body,
                syllable_count_target=s.target_syllables,
                syllable_count_actual=_approx_syllables(body),
            )
        )
    return out


# ---------------------------------------------------------------------------
# Module-level "active model" handle (mirrors cover-art-synth shape)
# ---------------------------------------------------------------------------


_active: LyricGenModel | None = None


def get_active_model() -> LyricGenModel | None:
    return _active


def set_active_model(m: LyricGenModel | None) -> None:
    global _active
    _active = m


def initialise_from_env() -> None:
    """Boot the backend named by `LYRIC_GEN_BACKEND` (default fake).

    Falls back to `FakeLyricGenModel` when the training extras aren't
    installed (CI / docker-compose without GPU), so the service always
    reaches a "loaded" state.
    """
    backend = os.environ.get("LYRIC_GEN_BACKEND", "fake").strip().lower()
    if backend == "fake":
        set_active_model(FakeLyricGenModel())
        return

    if backend != "indicbart":
        # Unknown backend name → fake.
        set_active_model(FakeLyricGenModel())
        return

    model_id = (
        os.environ.get("LYRIC_GEN_MODEL_DIR")
        or os.environ.get("LYRIC_GEN_MODEL_ID")
        or "ai4bharat/IndicBART"
    )
    adapter_id = os.environ.get("LYRIC_GEN_HF_ADAPTER")
    try:
        impl = _IndicBARTBackend(model_id, adapter_id)
        impl.load()
        set_active_model(impl)  # type: ignore[arg-type]
    except Exception:
        # If torch / transformers / peft aren't installed, fall back.
        set_active_model(FakeLyricGenModel())
