"""Tests for `scripts/prepare_dataset.py`.

Make sure the dataset prep:
  - Picks up the Sprint 6 PD corpus.
  - Emits >= 1 example per (entry, mood, style) cross.
  - Keeps train/eval split deterministic across reruns.
  - Refuses to emit if the corpus root is empty.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SCRIPTS_DIR = HERE.parent / "scripts"
REPO_ROOT = HERE.parents[2]
CORPUS_ROOT = REPO_ROOT / "data" / "public-lyrics"

# Add scripts/ to sys.path so we can import the module under test
# without packaging it as a library.
sys.path.insert(0, str(SCRIPTS_DIR))

import prepare_dataset  # noqa: E402  (sys.path mutation above)


@pytest.fixture()
def tmp_out(tmp_path: Path) -> Path:
    out = tmp_path / "lyric-gen-corpus"
    out.mkdir()
    return out


def _run(corpus_root: Path, out: Path, max_per_language: int = 2500) -> int:
    argv = [
        "prepare_dataset.py",
        "--corpus-root",
        str(corpus_root),
        "--out",
        str(out),
        "--max-per-language",
        str(max_per_language),
    ]
    old_argv = sys.argv
    sys.argv = argv
    try:
        return prepare_dataset.main()
    finally:
        sys.argv = old_argv


def test_prepare_dataset_emits_train_and_eval(tmp_out: Path) -> None:
    assert CORPUS_ROOT.is_dir(), (
        f"Sprint 6 corpus missing at {CORPUS_ROOT}; cannot run dataset prep test"
    )
    rc = _run(CORPUS_ROOT, tmp_out)
    assert rc == 0
    train = tmp_out / "train.jsonl"
    eval_ = tmp_out / "eval.jsonl"
    stats = tmp_out / "stats.json"
    assert train.exists()
    assert eval_.exists()
    assert stats.exists()
    train_count = sum(1 for _ in train.open("r", encoding="utf-8"))
    eval_count = sum(1 for _ in eval_.open("r", encoding="utf-8"))
    assert train_count > 0
    assert eval_count > 0
    payload = json.loads(stats.read_text(encoding="utf-8"))
    assert payload["train_count"] == train_count
    assert payload["eval_count"] == eval_count
    # All Sprint 6 languages should appear.
    expected_languages = {"en", "hi", "kn", "ta", "te", "bn", "sa"}
    seen = set(payload["by_language"].keys())
    assert expected_languages.issubset(seen), (
        f"missing languages in dataset: {expected_languages - seen}"
    )


def test_prepare_dataset_examples_have_required_fields(tmp_out: Path) -> None:
    _run(CORPUS_ROOT, tmp_out)
    with (tmp_out / "train.jsonl").open("r", encoding="utf-8") as f:
        first_line = f.readline()
    obj = json.loads(first_line)
    for key in (
        "prompt",
        "target",
        "language",
        "style_family",
        "source_id",
        "section_id",
        "section_type",
        "target_syllables",
    ):
        assert key in obj, f"missing field `{key}` in {obj}"
    # The target should be wrapped in the section tag the inference path
    # parses back out — kept in lockstep with `app.model._split_by_sections`.
    assert obj["target"].startswith("<section ")
    assert obj["target"].endswith("</section>")


def test_prepare_dataset_split_is_deterministic(tmp_out: Path, tmp_path: Path) -> None:
    """Re-running prepare_dataset.py with the same corpus must land on
    the same train/eval boundary. The split is hashed off (source_id,
    section_idx) so this is the contract we sell to the trainer."""
    out2 = tmp_path / "rerun"
    out2.mkdir()
    _run(CORPUS_ROOT, tmp_out)
    _run(CORPUS_ROOT, out2)
    a = (tmp_out / "train.jsonl").read_text(encoding="utf-8")
    b = (out2 / "train.jsonl").read_text(encoding="utf-8")
    assert a == b


def test_prepare_dataset_refuses_empty_corpus(tmp_path: Path, tmp_out: Path) -> None:
    empty_root = tmp_path / "empty-corpus"
    empty_root.mkdir()
    with pytest.raises(SystemExit):
        _run(empty_root, tmp_out)


def test_format_prompt_matches_model_format() -> None:
    """The prompt template used at train time MUST match the format the
    inference path reconstructs in `app.model._format_prompt`. If you
    change one, change the other."""
    from app.model import LyricGenRequest, LyricGenSection, _format_prompt

    train_prompt = prepare_dataset._format_prompt(
        language="hi",
        style_family="hindustani",
        mood="devotional",
        raga="bhairav",
        section_type="mukhda",
        target_syllables=12,
        prompt_text="dawn over the river",
    )
    req = LyricGenRequest(
        job_id="j",
        attempt_id=None,
        trace_id=None,
        language="hi",
        style_family="hindustani",
        mood="devotional",
        raga_name="bhairav",
        prompt="dawn over the river",
        sections=[
            LyricGenSection(
                section_id="mukhda-1", section_type="mukhda", target_syllables=12
            )
        ],
    )
    infer_prompt = _format_prompt(req)
    assert train_prompt == infer_prompt
