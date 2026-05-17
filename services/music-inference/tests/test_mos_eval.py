"""Tests for `scripts/mos_eval.py`.

The eval is operator-driven on the DGX (it calls the running
music-inference service over HTTP), but the survey building and
aggregation are pure-Python and we pin them here.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import mos_eval  # noqa: E402


def _write_prompts(path: Path) -> None:
    rows = [
        {
            "id": "p001",
            "style_family": "kannada-light-classical",
            "language": "kn",
            "lyrics": "ಭಯ ಬಯಲು",
            "raga": "yamuna-kalyani",
            "tala": "adi",
            "tempo_bpm": 70,
        },
        {
            "id": "p002",
            "style_family": "kannada-light-classical",
            "language": "kn",
            "lyrics": "ಮುಗಿಲು ಮಲ್ಲಿಗೆ",
            "raga": "kapi",
            "tala": "rupaka",
            "tempo_bpm": 80,
        },
    ]
    path.write_text("\n".join(json.dumps(r) for r in rows), encoding="utf-8")


def test_build_survey_pins_shuffle_per_prompt(tmp_path: Path) -> None:
    prompts_path = tmp_path / "prompts.jsonl"
    _write_prompts(prompts_path)
    out = tmp_path / "out"
    prompts = mos_eval.load_prompts(prompts_path)
    rows = mos_eval.build_survey(prompts, out)
    assert len(rows) == 2
    # Rerun: same shuffle must come back.
    rows2 = mos_eval.build_survey(prompts, out)
    assert [r.__dict__ for r in rows] == [r.__dict__ for r in rows2]
    saved = json.loads((out / "survey.json").read_text(encoding="utf-8"))
    assert {r["prompt_id"] for r in saved} == {"p001", "p002"}


def test_aggregate_reports_uplift_and_gate(tmp_path: Path) -> None:
    prompts_path = tmp_path / "prompts.jsonl"
    _write_prompts(prompts_path)
    out = tmp_path / "out"
    prompts = mos_eval.load_prompts(prompts_path)
    survey = mos_eval.build_survey(prompts, out)
    # Simulate 3 reviewers; adapter is consistently better.
    submissions: list[mos_eval.ReviewerSubmission] = []
    for prompt in prompts:
        # find which label is A
        srow = next(r for r in survey if r.prompt_id == prompt.id)
        for reviewer in ("rA", "rB", "rC"):
            if srow.a_label == "adapter":
                submissions.append(
                    mos_eval.ReviewerSubmission(reviewer, prompt.id, 4.5, 3.5)
                )
            else:
                submissions.append(
                    mos_eval.ReviewerSubmission(reviewer, prompt.id, 3.5, 4.5)
                )
    result = mos_eval.aggregate_mos(survey, submissions)
    assert result["overall"]["median_uplift"] == 1.0
    assert result["overall"]["passes_gate"] is True
    for prompt_row in result["by_prompt"]:
        assert prompt_row["baseline_mos"] == 3.5
        assert prompt_row["adapter_mos"] == 4.5
        assert prompt_row["uplift"] == 1.0


def test_aggregate_fails_gate_when_no_uplift(tmp_path: Path) -> None:
    prompts_path = tmp_path / "prompts.jsonl"
    _write_prompts(prompts_path)
    out = tmp_path / "out"
    prompts = mos_eval.load_prompts(prompts_path)
    survey = mos_eval.build_survey(prompts, out)
    submissions = []
    for prompt in prompts:
        for reviewer in ("rA", "rB", "rC"):
            submissions.append(
                mos_eval.ReviewerSubmission(reviewer, prompt.id, 3.5, 3.5)
            )
    result = mos_eval.aggregate_mos(survey, submissions)
    assert result["overall"]["median_uplift"] == 0.0
    assert result["overall"]["passes_gate"] is False


def test_aggregate_handles_no_submissions() -> None:
    result = mos_eval.aggregate_mos([], [])
    assert result["by_prompt"] == []
    assert result["overall"]["passes_gate"] is False
    assert result["overall"]["median_uplift"] is None
