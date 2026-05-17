"""Tests for `scripts/voice_benchmark.py` (v1.4 Sprint 12).

The benchmark is an operator script, but we still want CI to lock
in:

  * The dry-run path produces a deterministic markdown table.
  * Every (prompt, backend) cell shows up in the output.
  * The MOS proxy + speaker-consistency rubric stay in [0, 5] and
    [0, 1] respectively for a known synthetic WAV.

We import the script as a module via the `services/vocal-synth`
project path; pytest collects from that root so the `scripts`
folder is importable as `scripts.voice_benchmark`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.model import _write_wav_mono  # noqa: E402
from scripts.voice_benchmark import (  # noqa: E402
    BACKENDS,
    PromptRow,
    aggregate,
    load_backends,
    load_prompts,
    main,
    mos_proxy,
    render_one,
    render_table,
    speaker_consistency,
)


def _sine_wav(*, duration: float = 4.0, freq: float = 220.0) -> bytes:
    sr = 24000
    n = int(duration * sr)
    t = np.arange(n, dtype=np.float32) / sr
    wave = (0.3 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    return _write_wav_mono(wave, sr)


def _silent_wav(*, duration: float = 4.0) -> bytes:
    sr = 24000
    n = int(duration * sr)
    return _write_wav_mono(np.zeros(n, dtype=np.float32), sr)


def test_mos_proxy_rewards_vocal_band_sine() -> None:
    score = mos_proxy(_sine_wav(freq=440.0))
    assert score > 4.0


def test_mos_proxy_punishes_silence() -> None:
    score = mos_proxy(_silent_wav())
    assert score < 3.0


def test_speaker_consistency_is_high_for_stationary_tone() -> None:
    consistency = speaker_consistency(_sine_wav())
    assert consistency >= 0.9


def test_load_prompts_skips_comments_and_blanks(tmp_path: Path) -> None:
    p = tmp_path / "prompts.jsonl"
    p.write_text(
        "\n".join(
            [
                "# comment",
                "",
                json.dumps(
                    {
                        "prompt_id": "p1",
                        "text": "hello",
                        "language": "en",
                        "script": "latin",
                    }
                ),
            ]
        ),
        encoding="utf-8",
    )
    rows = load_prompts(p)
    assert len(rows) == 1
    assert rows[0].prompt_id == "p1"


def test_dry_run_load_backends_returns_four_fake_models() -> None:
    # Sprint 13: NeMo is real now, dry-run returns a fake for it too.
    backends = load_backends(dry_run=True)
    assert set(backends.keys()) == {"svara", "parler", "indicf5", "nemo"}


def test_render_one_emits_cell_for_dry_run_backend() -> None:
    backends = load_backends(dry_run=True)
    p = PromptRow(
        prompt_id="t-01",
        text="hello",
        language="en",
        script="latin",
        voice_id="en_in_male_announcer",
    )
    cell = render_one(prompt=p, backend="indicf5", backends=backends)
    assert cell.prompt_id == "t-01"
    assert cell.backend == "indicf5"
    # The fake model writes a deterministic WAV; the MOS proxy should
    # produce something in range.
    assert 0.0 <= cell.mos_proxy <= 5.0
    assert 0.0 <= cell.speaker_consistency <= 1.0


def test_render_one_reports_not_available_for_missing_backend() -> None:
    p = PromptRow(
        prompt_id="t-01",
        text="hello",
        language="en",
        script="latin",
        voice_id=None,
    )
    cell = render_one(prompt=p, backend="nemo", backends={})
    assert cell.note == "not-available"
    assert cell.mos_proxy == 0.0


def test_aggregate_reports_per_backend_means() -> None:
    backends = load_backends(dry_run=True)
    p = PromptRow(
        prompt_id="t-01",
        text="hello",
        language="hi",
        script="latin",
        voice_id="indic_hi_male_broadcast",
    )
    cells = [
        render_one(prompt=p, backend=b, backends=backends) for b in BACKENDS
    ]
    summary = aggregate(cells)
    assert set(summary.keys()) == set(BACKENDS)
    # Sprint 13: every backend is fake-loaded in dry-run.
    for b in BACKENDS:
        assert summary[b]["count"] == 1.0


def test_render_table_contains_every_backend_column() -> None:
    backends = load_backends(dry_run=True)
    p = PromptRow(
        prompt_id="t-01",
        text="hello",
        language="hi",
        script="latin",
        voice_id="indic_hi_male_broadcast",
    )
    cells = [
        render_one(prompt=p, backend=b, backends=backends) for b in BACKENDS
    ]
    table = render_table(cells, prompts=[p])
    for backend in BACKENDS:
        assert backend in table
    assert "t-01" in table


def test_main_dry_run_writes_markdown_and_jsonl(tmp_path: Path) -> None:
    prompts = tmp_path / "prompts.jsonl"
    prompts.write_text(
        json.dumps(
            {
                "prompt_id": "smoke-01",
                "text": "namaste",
                "language": "hi",
                "script": "latin",
                "voice_id": "indic_hi_male_broadcast",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    out_md = tmp_path / "out.md"
    out_jl = tmp_path / "out.jsonl"
    rc = _run_main(
        [
            "--prompts",
            str(prompts),
            "--out",
            str(out_md),
            "--out-jsonl",
            str(out_jl),
            "--dry-run",
        ]
    )
    assert rc == 0
    md = out_md.read_text(encoding="utf-8")
    assert "Sprint 12" in md
    assert "smoke-01" in md
    rows = [
        json.loads(line)
        for line in out_jl.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert len(rows) == len(BACKENDS)


def _run_main(argv: list[str]) -> int:
    """Invoke `main()` with a swapped sys.argv."""
    saved = sys.argv[:]
    try:
        sys.argv = ["voice_benchmark.py", *argv]
        return main()
    finally:
        sys.argv = saved
