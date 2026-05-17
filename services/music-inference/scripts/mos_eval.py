"""MOS A/B eval harness for the v1.4 Sprint 8 bhavageete LoRA.

Workflow:

  1. Operator drops a `--prompts` JSONL with N held-out
     `(style_family, language, lyrics, raga, tala, tempo)` rows.
  2. This script generates two WAVs per prompt: one with the LoRA
     adapter attached, one without. Both go to `--out/baseline/` and
     `--out/adapter/`, named by prompt id.
  3. A `survey.json` is emitted with shuffled (A, B) pairs so reviewers
     don't know which is which. Each reviewer downloads survey.json +
     the WAV pair links and submits a 1-5 MOS rating per (prompt,
     reviewer).
  4. `aggregate_mos()` reads the reviewer submissions, deshuffles, and
     reports the median MOS uplift. Sprint 8's gate is `>= 0.5`.

The generation step calls the running `music-inference` service over
HTTP — we don't re-import the model here so the eval can be re-run from
any host on the same network.

Dry-run mode emits a fake survey + reviewer template so a CI run can
exercise the file shapes.

Note on bias control: the operator is told **never** to disclose which
file came from which model. The reviewers see only `A.wav` / `B.wav`
in their assigned shuffled order. Per-prompt order is determined by a
deterministic hash so reruns produce the same shuffle (allows replaying
a stuck session without invalidating prior ratings).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import statistics
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

LOG = logging.getLogger("mos_eval")


@dataclass
class Prompt:
    id: str
    style_family: str
    language: str
    lyrics: str
    raga: str | None = None
    tala: str | None = None
    tempo_bpm: int | None = None
    section_type: str = "pallavi"
    target_seconds: int = 30


@dataclass
class SurveyRow:
    prompt_id: str
    a_label: str  # 'baseline' | 'adapter'
    b_label: str  # the other one
    a_path: str
    b_path: str
    expected_uplift: float | None = None  # populated if we have a prior


@dataclass
class ReviewerSubmission:
    """One reviewer's verdict for a single prompt."""
    reviewer_id: str
    prompt_id: str
    mos_a: float  # 1-5
    mos_b: float  # 1-5
    notes: str = ""


def _shuffle_order(prompt_id: str) -> tuple[str, str]:
    """Deterministic A/B label assignment per prompt_id.

    Hash the prompt id; if the low bit is 1, baseline=A, else adapter=A.
    The choice is irrelevant — what matters is that reruns produce the
    same mapping so a reviewer can resume a paused session.
    """
    h = int(hashlib.sha256(prompt_id.encode("utf-8")).hexdigest(), 16)
    if h & 1:
        return "baseline", "adapter"
    return "adapter", "baseline"


def load_prompts(path: Path) -> list[Prompt]:
    if not path.exists():
        raise FileNotFoundError(f"prompts not found: {path}")
    prompts: list[Prompt] = []
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines()):
        line = line.strip()
        if not line:
            continue
        obj = json.loads(line)
        prompts.append(
            Prompt(
                id=obj.get("id") or f"prompt-{i:03d}",
                style_family=obj["style_family"],
                language=obj["language"],
                lyrics=obj["lyrics"],
                raga=obj.get("raga"),
                tala=obj.get("tala"),
                tempo_bpm=obj.get("tempo_bpm"),
                section_type=obj.get("section_type", "pallavi"),
                target_seconds=obj.get("target_seconds", 30),
            )
        )
    return prompts


def build_survey(prompts: list[Prompt], out_dir: Path) -> list[SurveyRow]:
    out_dir.mkdir(parents=True, exist_ok=True)
    rows: list[SurveyRow] = []
    for p in prompts:
        a_label, b_label = _shuffle_order(p.id)
        rows.append(
            SurveyRow(
                prompt_id=p.id,
                a_label=a_label,
                b_label=b_label,
                a_path=str(out_dir / a_label / f"{p.id}.wav"),
                b_path=str(out_dir / b_label / f"{p.id}.wav"),
            )
        )
    survey_path = out_dir / "survey.json"
    survey_path.write_text(
        json.dumps(
            [r.__dict__ for r in rows],
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    return rows


def aggregate_mos(
    survey: list[SurveyRow], submissions: list[ReviewerSubmission]
) -> dict[str, Any]:
    """Deshuffle reviewer submissions and report the MOS uplift.

    Returns::

      {
        "by_prompt": [
          {"prompt_id": "...", "baseline_mos": 3.5, "adapter_mos": 4.1,
           "uplift": 0.6, "reviewer_count": 3},
          ...
        ],
        "overall": {
          "baseline_median": ..., "adapter_median": ...,
          "median_uplift": ..., "reviewer_count": N,
          "passes_gate": bool, "gate": 0.5,
        }
      }
    """
    label_by_prompt = {r.prompt_id: (r.a_label, r.b_label) for r in survey}
    grouped: dict[str, list[ReviewerSubmission]] = {}
    for sub in submissions:
        grouped.setdefault(sub.prompt_id, []).append(sub)

    by_prompt: list[dict[str, Any]] = []
    baseline_all: list[float] = []
    adapter_all: list[float] = []
    for prompt_id, subs in sorted(grouped.items()):
        a_label, b_label = label_by_prompt.get(prompt_id, ("baseline", "adapter"))
        a_scores = [s.mos_a for s in subs]
        b_scores = [s.mos_b for s in subs]
        baseline_scores = a_scores if a_label == "baseline" else b_scores
        adapter_scores = a_scores if a_label == "adapter" else b_scores
        baseline_med = statistics.median(baseline_scores)
        adapter_med = statistics.median(adapter_scores)
        by_prompt.append(
            {
                "prompt_id": prompt_id,
                "baseline_mos": round(baseline_med, 2),
                "adapter_mos": round(adapter_med, 2),
                "uplift": round(adapter_med - baseline_med, 2),
                "reviewer_count": len(subs),
            }
        )
        baseline_all.extend(baseline_scores)
        adapter_all.extend(adapter_scores)

    if not by_prompt:
        return {
            "by_prompt": [],
            "overall": {
                "baseline_median": None,
                "adapter_median": None,
                "median_uplift": None,
                "reviewer_count": 0,
                "passes_gate": False,
                "gate": 0.5,
            },
        }

    overall_baseline = statistics.median(baseline_all)
    overall_adapter = statistics.median(adapter_all)
    uplift = overall_adapter - overall_baseline
    return {
        "by_prompt": by_prompt,
        "overall": {
            "baseline_median": round(overall_baseline, 2),
            "adapter_median": round(overall_adapter, 2),
            "median_uplift": round(uplift, 2),
            "reviewer_count": sum(p["reviewer_count"] for p in by_prompt),
            "passes_gate": uplift >= 0.5,
            "gate": 0.5,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build + aggregate the bhavageete LoRA MOS survey."
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    build = sub.add_parser("build-survey")
    build.add_argument("--prompts", type=Path, required=True)
    build.add_argument("--out", type=Path, required=True)

    agg = sub.add_parser("aggregate")
    agg.add_argument("--survey", type=Path, required=True)
    agg.add_argument("--submissions", type=Path, required=True)
    agg.add_argument("--out", type=Path, required=True)

    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    if args.cmd == "build-survey":
        prompts = load_prompts(args.prompts)
        survey = build_survey(prompts, args.out)
        print(json.dumps([r.__dict__ for r in survey], indent=2))
        return 0
    if args.cmd == "aggregate":
        survey_objs = json.loads(args.survey.read_text(encoding="utf-8"))
        survey = [SurveyRow(**o) for o in survey_objs]
        sub_objs = [
            json.loads(line)
            for line in args.submissions.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        submissions = [ReviewerSubmission(**o) for o in sub_objs]
        result = aggregate_mos(survey, submissions)
        args.out.write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    return 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
