"""Tests for `scripts/eval.py` --dry-run path.

The real eval path needs a trained checkpoint + transformers; CI runs
the dry-run path which validates the harness shape without those.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS_DIR = HERE.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import eval as eval_script  # noqa: E402  (sys.path mutation above)


def _write_eval_set(path: Path) -> None:
    lines = [
        {
            "prompt": "<2hi> style=hindustani mood=devotional raga=bhairav sections=mukhda(12) | a short lyric",
            "target": "<section mukhda-1>kabira teri jhopdi gala gala katraan</section>",
            "language": "hi",
            "style_family": "hindustani",
            "source_id": "hi/kabir-pothi",
            "section_id": "mukhda-1",
            "section_type": "mukhda",
            "target_syllables": 12,
        },
        {
            "prompt": "<2sa> style=sanskrit-shloka mood=neutral raga=unset sections=shloka_verse(16) | a chant",
            "target": "<section shloka_verse-1>vande shree gaja vadanam</section>",
            "language": "sa",
            "style_family": "sanskrit-shloka",
            "source_id": "sa/gayatri-mantra",
            "section_id": "shloka_verse-1",
            "section_type": "shloka_verse",
            "target_syllables": 16,
        },
    ]
    with path.open("w", encoding="utf-8") as f:
        for obj in lines:
            f.write(json.dumps(obj) + "\n")


def test_eval_dry_run_writes_gate_report(tmp_path: Path) -> None:
    eval_set = tmp_path / "eval.jsonl"
    _write_eval_set(eval_set)
    out = tmp_path / "out.json"

    argv = [
        "eval.py",
        "--checkpoint",
        str(tmp_path),  # unused in dry-run
        "--eval-set",
        str(eval_set),
        "--out",
        str(out),
        "--dry-run",
        "--no-g2p",
        "--no-judge",
    ]
    old_argv = sys.argv
    sys.argv = argv
    try:
        rc = eval_script.main()
    finally:
        sys.argv = old_argv

    assert rc == 0
    assert out.exists()
    payload = json.loads(out.read_text(encoding="utf-8"))
    assert "by_language" in payload
    assert "hi" in payload["by_language"]
    assert "sa" in payload["by_language"]
    # Dry-run substitutes target as generation, so all samples pass the
    # syllable gate (delta == 0) once --no-syllable is implicit-false.
    assert payload["gates"]["syllable_hit_ratio"] is not None
    assert payload["gates"]["g2p_clean_ratio"] is not None
