"""Load v1.4-bench prompts from YAML into typed Prompt dataclasses.

Why a tiny YAML parser instead of pyyaml?
  - The bench prompt files use only a single very small subset of YAML
    (block sequences of mappings, scalars, and a flow mapping for the
    `expected` field). Pulling pyyaml into evals just for this is
    overkill, and we already pin our service deps tightly.
  - The parser below intentionally rejects anything outside the
    documented prompt shape so a malformed file fails loudly rather
    than silently coercing.

CLI: `python -m evals.v1.4-bench.scripts.bench_loader` prints the
prompt count and per-style totals. The check is wired into the test
suite at `evals/v1.4-bench/tests/test_bench_loader.py`.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
PROMPTS_DIR = BENCH_ROOT / "prompts"

# Per the plan, ten styles × ten prompts each.
EXPECTED_STYLES: tuple[str, ...] = (
    "carnatic",
    "hindustani",
    "bhavageete",
    "tamil-folk",
    "bollywood",
    "kabir",
    "tagore",
    "western",
    "sanskrit-shloka",
    "rabindrasangeet",
)
PROMPTS_PER_STYLE = 10


@dataclass(frozen=True)
class Expected:
    raga: str | None
    tala: str | None
    voice_persona: str


@dataclass(frozen=True)
class Prompt:
    id: str
    style: str
    language: str
    lyrics_seed: str
    expected: Expected
    duration_seconds: int


def _strip_quotes(value: str) -> str:
    value = value.strip()
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        return value[1:-1]
    return value


def _parse_scalar(raw: str) -> object:
    raw = raw.strip()
    if raw == "null" or raw == "~" or raw == "":
        return None
    if raw.lower() == "true":
        return True
    if raw.lower() == "false":
        return False
    if re.fullmatch(r"-?\d+", raw):
        return int(raw)
    if re.fullmatch(r"-?\d+\.\d+", raw):
        return float(raw)
    return _strip_quotes(raw)


_FLOW_SPLIT = re.compile(r",(?=(?:[^\"']*[\"'][^\"']*[\"'])*[^\"']*$)")


def _parse_flow_mapping(text: str) -> dict[str, object]:
    text = text.strip()
    if not (text.startswith("{") and text.endswith("}")):
        raise ValueError(f"expected flow mapping, got: {text!r}")
    inner = text[1:-1].strip()
    if not inner:
        return {}
    out: dict[str, object] = {}
    for chunk in _FLOW_SPLIT.split(inner):
        chunk = chunk.strip()
        if not chunk:
            continue
        if ":" not in chunk:
            raise ValueError(f"flow mapping entry missing ':' -- {chunk!r}")
        key, _, value = chunk.partition(":")
        out[key.strip()] = _parse_scalar(value)
    return out


def _load_yaml_prompts(path: Path) -> list[dict[str, object]]:
    """Parse a prompt YAML file into a list of dict rows.

    Tolerates only the documented shape:

        prompts:
          - id: ...
            style: ...
            ...
            expected: { raga: ..., tala: ..., voice_persona: ... }
            duration_seconds: 60
    """

    lines = path.read_text(encoding="utf-8").splitlines()
    prompts: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    inside_prompts = False
    for raw_line in lines:
        line = raw_line.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if line.startswith("prompts:"):
            inside_prompts = True
            continue
        if not inside_prompts:
            continue
        stripped = line.lstrip(" ")
        indent = len(line) - len(stripped)
        if stripped.startswith("- "):
            if current is not None:
                prompts.append(current)
            current = {}
            tail = stripped[2:]
            if ":" in tail:
                key, _, value = tail.partition(":")
                current[key.strip()] = _parse_scalar(value)
            continue
        if current is None:
            raise ValueError(f"{path}: stray line outside a prompt: {raw_line!r}")
        if indent < 4:
            raise ValueError(
                f"{path}: unexpected indent on field line: {raw_line!r}",
            )
        key, _, value = stripped.partition(":")
        key = key.strip()
        value = value.strip()
        if value.startswith("{"):
            current[key] = _parse_flow_mapping(value)
        else:
            current[key] = _parse_scalar(value)
    if current is not None:
        prompts.append(current)
    return prompts


def _coerce_prompt(row: dict[str, object], path: Path) -> Prompt:
    try:
        expected_raw = row["expected"]
        if not isinstance(expected_raw, dict):
            raise ValueError(f"`expected` is not a mapping: {expected_raw!r}")
        expected = Expected(
            raga=expected_raw.get("raga"),  # type: ignore[arg-type]
            tala=expected_raw.get("tala"),  # type: ignore[arg-type]
            voice_persona=str(expected_raw["voice_persona"]),
        )
        return Prompt(
            id=str(row["id"]),
            style=str(row["style"]),
            language=str(row["language"]),
            lyrics_seed=str(row["lyrics_seed"]),
            expected=expected,
            duration_seconds=int(row["duration_seconds"]),
        )
    except KeyError as exc:
        raise ValueError(f"{path}: missing required field {exc!s}") from exc


def load_style(style: str) -> list[Prompt]:
    """Load and validate the prompts for one style file."""
    path = PROMPTS_DIR / f"{style}.yaml"
    if not path.is_file():
        raise FileNotFoundError(f"prompt file not found: {path}")
    rows = _load_yaml_prompts(path)
    return [_coerce_prompt(row, path) for row in rows]


def load_all() -> list[Prompt]:
    """Load every prompt file, verifying the documented shape."""
    out: list[Prompt] = []
    for style in EXPECTED_STYLES:
        prompts = load_style(style)
        if len(prompts) != PROMPTS_PER_STYLE:
            raise ValueError(
                f"{style}: expected {PROMPTS_PER_STYLE} prompts, got "
                f"{len(prompts)}",
            )
        for p in prompts:
            if p.style != style:
                raise ValueError(
                    f"{style}: row id={p.id} has style={p.style!r} "
                    f"(expected {style!r})",
                )
        out.extend(prompts)
    return out


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    prompts = load_all()
    if "--json" in argv:
        print(json.dumps([asdict(p) for p in prompts], indent=2))
        return 0
    by_style: dict[str, int] = {}
    for p in prompts:
        by_style[p.style] = by_style.get(p.style, 0) + 1
    print(f"loaded {len(prompts)} prompts:")
    for style in EXPECTED_STYLES:
        print(f"  {style:24s} {by_style.get(style, 0):>2d}")
    if len(prompts) != len(EXPECTED_STYLES) * PROMPTS_PER_STYLE:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
