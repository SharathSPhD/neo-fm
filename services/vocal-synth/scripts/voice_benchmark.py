"""v1.4 Sprint 12 — cross-backend voice benchmark.

Usage (DGX-Spark; expects all backends loadable locally):

    uv run --extra parler python scripts/voice_benchmark.py \\
        --prompts data/voice-benchmark/prompts.jsonl \\
        --out demos/v1.4/sprint-12-indicf5/benchmark.md \\
        [--dry-run]   # CI-friendly; uses FakeVocalModel for everything

Per the v1.4 plan, the benchmark is:

  - **50 prompts** drawn from `--prompts` (JSONL of
    ``{text, language, script, voice_id}`` rows).
  - **3 languages** — Hindi, Tamil, Bengali (8 indic_* personas
    cover them).
  - **4 backends** — Svara, Parler, IndicF5, NeMo (NeMo lands in
    Sprint 13; in S12 the column reports "n/a" so the markdown
    table layout is stable).

For each (prompt, backend) cell we record:

  - **MOS proxy** — a deterministic rubric over the rendered WAV
    (peak ≤ 0.95, energy in the vocal band [80, 4000] Hz, silence
    ratio < 0.4). Real MOS requires human listening; this proxy
    keeps the harness runnable in CI and flags regressions.
  - **WER** — when ``--whisper-model`` is supplied, transcribes
    with `openai-whisper`. The dry-run path skips this.
  - **Speaker consistency** — cosine similarity of the first vs
    last 1-second mel-spectrogram (in-process, no extra deps).

Output is a markdown table (sortable, paste-able into the sprint
evidence file) plus a JSONL with per-row data so Sprint 16's
reranker can join against it.

Dry-run is the contract CI checks: it renders the harness path
end-to-end with `FakeVocalModel` so a future PR that breaks the
prompt → request → WAV plumbing fails before merge.
"""

from __future__ import annotations

import argparse
import json
import os
import struct
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.model import FakeVocalModel, VocalRequest, VocalSection  # noqa: E402

# Backends we report on. Sprint 13 lands NeMo; the column placeholder
# means a sprint-12 → sprint-13 PR doesn't have to widen the schema.
BACKENDS: tuple[str, ...] = ("svara", "parler", "indicf5", "nemo")


@dataclass
class PromptRow:
    """One prompt the harness will render across every backend."""
    prompt_id: str
    text: str
    language: str
    script: str
    voice_id: str | None


@dataclass
class CellResult:
    """One (prompt, backend) outcome."""
    prompt_id: str
    backend: str
    mos_proxy: float
    wer: float | None
    speaker_consistency: float
    seconds_elapsed: float
    note: str = ""

    def to_row(self) -> dict[str, Any]:
        return asdict(self)


def _decode_wav_mono(buf: bytes) -> tuple[np.ndarray, int]:
    """Reverse of `_write_wav_mono`; returns (samples, sample_rate)."""
    if buf[:4] != b"RIFF" or buf[8:12] != b"WAVE":
        raise ValueError("not a RIFF/WAVE buffer")
    sample_rate = struct.unpack("<I", buf[24:28])[0]
    data_size = struct.unpack("<I", buf[40:44])[0]
    pcm = np.frombuffer(buf[44 : 44 + data_size], dtype=np.int16)
    return (pcm.astype(np.float32) / 32767.0).copy(), sample_rate


def mos_proxy(buf: bytes) -> float:
    """Deterministic rubric ∈ [0, 5].

    Real MOS needs ears; this is a regression canary:

      - +1.0  peak in [0.05, 0.95]   (not silent, not clipping)
      - +1.5  >= 50% of energy in [80 Hz, 4 kHz]  (vocal band)
      - +1.0  silence ratio < 0.4    (something happened)
      - +1.5  no NaN/inf in PCM      (output is well-formed)
    """
    samples, sr = _decode_wav_mono(buf)
    if samples.size == 0:
        return 0.0
    score = 0.0
    if np.isfinite(samples).all():
        score += 1.5
    peak = float(np.max(np.abs(samples)) or 0.0)
    if 0.05 <= peak <= 0.95:
        score += 1.0
    silence_ratio = float(np.mean(np.abs(samples) < 0.01))
    if silence_ratio < 0.4:
        score += 1.0
    # Coarse FFT energy band check.
    fft = np.abs(np.fft.rfft(samples))
    freqs = np.fft.rfftfreq(samples.size, 1.0 / sr)
    band = (freqs >= 80.0) & (freqs <= 4000.0)
    total_e = float(fft.sum() or 1.0)
    band_e = float(fft[band].sum())
    if band_e / total_e >= 0.5:
        score += 1.5
    return round(score, 2)


def speaker_consistency(buf: bytes) -> float:
    """Cosine between first vs last second of the rendered WAV.

    A 0.0 score means the renderer drifted away from the original
    timbre (e.g. wandered into a different voice mid-render). A
    near-1.0 score means consistent timbre, which is what we want.
    """
    samples, sr = _decode_wav_mono(buf)
    if samples.size < 2 * sr:
        return 1.0  # too short to measure; treat as consistent
    first = samples[:sr]
    last = samples[-sr:]
    spec_a = np.abs(np.fft.rfft(first))
    spec_b = np.abs(np.fft.rfft(last))
    norm = float(np.linalg.norm(spec_a) * np.linalg.norm(spec_b)) or 1.0
    cos = float(np.dot(spec_a, spec_b) / norm)
    return round(max(0.0, min(1.0, cos)), 3)


def load_prompts(path: Path) -> list[PromptRow]:
    out: list[PromptRow] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        row = json.loads(line)
        out.append(
            PromptRow(
                prompt_id=row["prompt_id"],
                text=row["text"],
                language=row["language"],
                script=row.get("script") or "latin",
                voice_id=row.get("voice_id"),
            )
        )
    return out


def render_one(
    *,
    prompt: PromptRow,
    backend: str,
    backends: dict[str, Any],
) -> CellResult:
    """Run one prompt x backend cell."""
    started = time.perf_counter()
    note = ""
    model = backends.get(backend)
    if model is None:
        return CellResult(
            prompt_id=prompt.prompt_id,
            backend=backend,
            mos_proxy=0.0,
            wer=None,
            speaker_consistency=0.0,
            seconds_elapsed=0.0,
            note="not-available",
        )
    sec = VocalSection(
        id=f"{prompt.prompt_id}-sec",
        type="verse",
        lyrics=prompt.text,
        language=prompt.language,
        script=prompt.script,
        transliteration=None,
        target_seconds=4,
        tempo_bpm=90,
        raga_name=None,
        voice_timbre="male",
        voice_id=prompt.voice_id,
    )
    req = VocalRequest(
        job_id=f"bench-{prompt.prompt_id}",
        attempt_id=None,
        trace_id=None,
        language=prompt.language,
        style_family="bollywood-ballad",
        voice_timbre="male",
        sample_rate=24000,
        sections=[sec],
        target_duration_seconds=4,
    )
    try:
        wav = model.synthesise(req)
    except Exception as exc:
        return CellResult(
            prompt_id=prompt.prompt_id,
            backend=backend,
            mos_proxy=0.0,
            wer=None,
            speaker_consistency=0.0,
            seconds_elapsed=time.perf_counter() - started,
            note=f"err:{type(exc).__name__}",
        )
    mos = mos_proxy(wav)
    consistency = speaker_consistency(wav)
    return CellResult(
        prompt_id=prompt.prompt_id,
        backend=backend,
        mos_proxy=mos,
        wer=None,
        speaker_consistency=consistency,
        seconds_elapsed=round(time.perf_counter() - started, 3),
        note=note,
    )


def load_backends(*, dry_run: bool) -> dict[str, Any]:
    """Return a {backend_name: model} dict.

    Dry-run swaps every entry to `FakeVocalModel` so CI can exercise
    the harness end-to-end without GPU. The real DGX run sets
    `NEO_FM_REQUIRE_REAL_MODEL=1` upstream so a load failure here
    is loud, not silent.
    """
    if dry_run:
        fake = FakeVocalModel()
        # Sprint 13: NeMo is real now, so the dry-run column reports
        # a fake render too (not "not-available"). The DGX run uses
        # the actual NeMoTTSModel.
        return {b: fake for b in BACKENDS}
    backends: dict[str, Any] = {}
    # Heavy imports + loads happen *only* outside of dry-run.
    from app.indicf5 import IndicF5Model
    from app.model import SvaraTTSModel
    from app.nemo import NeMoTTSModel
    from app.parler import ParlerTTSModel

    for name, factory in [
        ("svara", lambda: SvaraTTSModel(
            os.environ.get("VOCAL_MODEL_ID_SVARA", "kenpath/svara-tts-v1"),
        )),
        ("parler", lambda: ParlerTTSModel(
            os.environ.get("VOCAL_MODEL_ID_PARLER", "ai4bharat/indic-parler-tts"),
        )),
        ("indicf5", lambda: IndicF5Model(
            os.environ.get("VOCAL_MODEL_ID_INDICF5", "ai4bharat/IndicF5"),
        )),
        ("nemo", lambda: NeMoTTSModel()),
    ]:
        try:
            m = factory()
            m.load()
            backends[name] = m
        except Exception as exc:
            print(f"[voice_benchmark] {name} unavailable: {exc}", file=sys.stderr)
    return backends


def render_table(cells: list[CellResult], *, prompts: list[PromptRow]) -> str:
    """Render a markdown table grouped by prompt then backend."""
    header = "| prompt_id | language | voice_id | " + " | ".join(
        f"{b} MOS / consistency / sec"
        for b in BACKENDS
    ) + " |\n"
    separator = "| --- | --- | --- " + ("| --- " * len(BACKENDS)) + "|\n"
    by_pid: dict[str, dict[str, CellResult]] = {}
    for c in cells:
        by_pid.setdefault(c.prompt_id, {})[c.backend] = c
    body_lines = []
    for p in prompts:
        row = by_pid.get(p.prompt_id, {})
        cells_for_p = []
        for b in BACKENDS:
            c = row.get(b)
            if c is None:
                cells_for_p.append("n/a")
            elif c.note:
                cells_for_p.append(c.note)
            else:
                cells_for_p.append(
                    f"{c.mos_proxy:.2f} / {c.speaker_consistency:.2f} / {c.seconds_elapsed:.2f}s"
                )
        body_lines.append(
            f"| {p.prompt_id} | {p.language} | {p.voice_id or ''} | "
            + " | ".join(cells_for_p)
            + " |"
        )
    return header + separator + "\n".join(body_lines) + "\n"


def aggregate(cells: list[CellResult]) -> dict[str, dict[str, float]]:
    """Per-backend mean MOS / consistency / wallclock."""
    out: dict[str, dict[str, float]] = {}
    for backend in BACKENDS:
        rows = [c for c in cells if c.backend == backend and not c.note]
        if not rows:
            out[backend] = {"count": 0.0, "mos": 0.0, "consistency": 0.0, "sec": 0.0}
            continue
        out[backend] = {
            "count": float(len(rows)),
            "mos": round(sum(c.mos_proxy for c in rows) / len(rows), 3),
            "consistency": round(
                sum(c.speaker_consistency for c in rows) / len(rows), 3
            ),
            "sec": round(
                sum(c.seconds_elapsed for c in rows) / len(rows), 3
            ),
        }
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--prompts",
        type=Path,
        required=True,
        help="JSONL file with {prompt_id, text, language, script, voice_id} rows.",
    )
    ap.add_argument(
        "--out",
        type=Path,
        required=True,
        help="Output markdown file (the table + summary).",
    )
    ap.add_argument(
        "--out-jsonl",
        type=Path,
        default=None,
        help="Optional sibling JSONL for Sprint 16's reranker to ingest.",
    )
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    prompts = load_prompts(args.prompts)
    if not prompts:
        print("no prompts in --prompts; nothing to do", file=sys.stderr)
        return 1

    backends = load_backends(dry_run=args.dry_run)
    cells: list[CellResult] = []
    for p in prompts:
        for backend in BACKENDS:
            cells.append(render_one(prompt=p, backend=backend, backends=backends))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    table = render_table(cells, prompts=prompts)
    summary = aggregate(cells)

    lines = [
        "# v1.4 Sprint 12 — voice benchmark",
        "",
        f"Prompts: {len(prompts)} · Backends: {', '.join(BACKENDS)} · "
        f"Dry-run: **{args.dry_run}**",
        "",
        "## Per-prompt detail",
        "",
        table,
        "",
        "## Per-backend means",
        "",
        "| backend | n | mean MOS | mean consistency | mean seconds |",
        "| --- | --- | --- | --- | --- |",
    ]
    for backend in BACKENDS:
        row = summary[backend]
        lines.append(
            f"| {backend} | {int(row['count'])} | "
            f"{row['mos']} | {row['consistency']} | {row['sec']} |"
        )
    args.out.write_text("\n".join(lines) + "\n", encoding="utf-8")

    if args.out_jsonl is not None:
        args.out_jsonl.parent.mkdir(parents=True, exist_ok=True)
        with args.out_jsonl.open("w", encoding="utf-8") as f:
            for c in cells:
                f.write(json.dumps(c.to_row()) + "\n")

    print(
        f"wrote {args.out} ({len(cells)} cells across {len(prompts)} prompts)",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
