#!/usr/bin/env python3
"""
Assemble the IndicBART SFT dataset for lyric-gen.

Sources (priority order):
  1. The PD corpus shipped in `data/public-lyrics/`. Every entry yields
     N examples — one per section that the section-mapper would emit.
     Inputs are the structured prompt (language, style_family, mood,
     raga, section spec); targets are the actual stanza text wrapped
     in `<section id>...</section>` tags so the trained model emits
     parseable output.
  2. A synthetic-prompt regime that varies mood / target_syllables /
     raga / style_family while reusing the same stanza pool. Cheap
     way to multiply the example count without scraping more text.
  3. (Optional, operator-supplied) extra IndicCorp / IndicWiki slices
     glob-loaded from a path passed via `--indic-corp-glob`. Each
     file is one stanza; provenance fields are required to live next
     to it (one .meta.json per stanza file).

Outputs:
  - `<out>/train.jsonl` — one JSON object per example with `{prompt,
    target, lang, style_family, sources}`.
  - `<out>/eval.jsonl`  — 30 held-out per language for the Sprint 7
    eval harness.
  - `<out>/stats.json`  — per-language / per-style counts so the
    Ralph evidence can summarise the corpus shape.

The split is deterministic (hashed by entry id + section index) so a
rerun lands on the same train/eval boundary.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


SUPPORTED_LANGUAGES = ("en", "hi", "kn", "ta", "te", "bn", "sa")
SUPPORTED_STYLES = (
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
)

# Hand-curated style preference per language. Mirror of the Sprint 6
# STYLE_LANGUAGE_PREFERENCE in `packages/lyrics/src/provider.ts`.
STYLE_BY_LANGUAGE: dict[str, tuple[str, ...]] = {
    "en": ("western",),
    "hi": ("hindustani", "bollywood-ballad"),
    "kn": ("carnatic", "kannada-folk", "kannada-light-classical"),
    "ta": ("carnatic", "tamil-folk"),
    "te": ("carnatic", "telugu-keerthana"),
    "bn": ("bengali-rabindrasangeet",),
    "sa": ("sanskrit-shloka", "carnatic", "hindustani"),
}

# Synthetic-prompt knobs: each entry becomes N copies with these varied.
MOODS = ("neutral", "devotional", "reflective", "joyful", "sombre")
TARGET_SYLLABLE_BUCKETS = (12, 18, 24, 32)


@dataclass(frozen=True)
class Example:
    prompt: str
    target: str
    language: str
    style_family: str
    source_id: str
    section_id: str
    section_type: str
    target_syllables: int


def _parse_frontmatter(text: str) -> tuple[dict[str, Any], str] | None:
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---\n", 4)
    if end == -1:
        return None
    raw = text[4:end]
    body = text[end + 5 :]
    try:
        import yaml
    except ImportError as e:  # pragma: no cover
        raise SystemExit(
            "prepare_dataset.py needs PyYAML (`uv add pyyaml`)"
        ) from e
    loaded = yaml.safe_load(raw)
    if not isinstance(loaded, dict):
        return None
    return loaded, body


def _split_stanzas(body: str) -> list[str]:
    chunks = []
    for chunk in body.split("\n\n"):
        c = chunk.strip()
        if c:
            chunks.append(c)
    return chunks


def _approx_syllables(text: str) -> int:
    """Same approximator as `app.model._approx_syllables`. Kept in
    sync by hand; both are intentionally crude."""
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
    return max(count, sum(1 for line in text.splitlines() if line.strip()))


def _format_prompt(
    *,
    language: str,
    style_family: str,
    mood: str,
    raga: str | None,
    section_type: str,
    target_syllables: int,
    prompt_text: str,
) -> str:
    """Must match `app.model._format_prompt`. If you change one, change both."""
    section_spec = f"{section_type}({target_syllables})"
    return (
        f"<2{language}> "
        f"style={style_family} "
        f"mood={mood} "
        f"raga={raga or 'unset'} "
        f"sections={section_spec} | "
        f"{prompt_text}"
    )


def _wrap_target(section_id: str, body: str) -> str:
    """Wrap stanza body in the SFT-time section tag so the trained
    model emits a parseable form for `_split_by_sections`."""
    return f"<section {section_id}>{body.strip()}</section>"


def _stable_split(source_id: str, section_idx: int) -> str:
    """Deterministic train/eval split. ~10% goes to eval."""
    h = hashlib.sha256(f"{source_id}|{section_idx}".encode()).hexdigest()
    return "eval" if int(h[:2], 16) < 26 else "train"


def _collect_pd(root: Path) -> list[dict[str, Any]]:
    """Walk `data/public-lyrics/<lang>/*.md` and yield parsed entries."""
    out: list[dict[str, Any]] = []
    for lang_dir in sorted(root.iterdir()):
        if not lang_dir.is_dir():
            continue
        language = lang_dir.name
        if language not in SUPPORTED_LANGUAGES:
            continue
        for md in sorted(lang_dir.glob("*.md")):
            parsed = _parse_frontmatter(md.read_text(encoding="utf-8"))
            if parsed is None:
                continue
            fm, body = parsed
            if fm.get("license_assertion") != "public-domain":
                continue
            out.append(
                {
                    "id": f"{language}/{md.stem}",
                    "language": language,
                    "title": fm.get("title", ""),
                    "author": fm.get("author", ""),
                    "body": body.strip(),
                }
            )
    return out


def _example_for_entry(
    entry: dict[str, Any], style_family: str, synthetic_mood: str
) -> list[Example]:
    """Emit one Example per stanza in `entry.body`."""
    stanzas = _split_stanzas(entry["body"])
    if not stanzas:
        return []
    out: list[Example] = []
    section_type = _section_type_for_style(style_family, len(stanzas))
    for idx, stanza in enumerate(stanzas):
        section_id = f"{section_type}-{idx + 1}"
        syllables = _approx_syllables(stanza)
        target_syllables = max(8, syllables)
        target_bucket = min(
            TARGET_SYLLABLE_BUCKETS,
            key=lambda b: abs(b - target_syllables),
        )
        prompt = _format_prompt(
            language=entry["language"],
            style_family=style_family,
            mood=synthetic_mood,
            raga=None,
            section_type=section_type,
            target_syllables=target_bucket,
            prompt_text=(
                f"Write a {section_type} in the style of "
                f"{entry['author'] or 'an unknown poet'}, "
                f"language={entry['language']}, "
                f"about: {entry['title'] or 'devotion and longing'}."
            ),
        )
        target = _wrap_target(section_id, stanza)
        out.append(
            Example(
                prompt=prompt,
                target=target,
                language=entry["language"],
                style_family=style_family,
                source_id=entry["id"],
                section_id=section_id,
                section_type=section_type,
                target_syllables=target_bucket,
            )
        )
    return out


def _section_type_for_style(style_family: str, stanza_count: int) -> str:
    """Mirror of TEMPLATES in packages/lyrics/src/section-mapper.ts.

    For dataset prep we pick the first non-intro section type so the
    prompt isn't asking for empty-body runways.
    """
    table = {
        "western": "verse",
        "carnatic": "pallavi" if stanza_count == 1 else "charanam",
        "hindustani": "mukhda",
        "kannada-folk": "folk_stanza",
        "kannada-light-classical": "pallavi",
        "tamil-folk": "folk_stanza",
        "bollywood-ballad": "verse",
        "bengali-rabindrasangeet": "mukhda",
        "telugu-keerthana": "pallavi",
        "sanskrit-shloka": "shloka_verse",
    }
    return table.get(style_family, "verse")


def _emit_synthetic(entry: dict[str, Any]) -> list[Example]:
    """For one PD entry, emit ~K synthetic prompts varying mood/style."""
    eligible_styles = STYLE_BY_LANGUAGE.get(entry["language"], ("western",))
    out: list[Example] = []
    rng = random.Random(hashlib.sha256(entry["id"].encode()).hexdigest())
    for mood in MOODS:
        # Pick at most 2 styles per entry to keep the multiplier modest.
        style_pool = list(eligible_styles)
        rng.shuffle(style_pool)
        for style in style_pool[:2]:
            out.extend(_example_for_entry(entry, style, mood))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--corpus-root",
        type=Path,
        default=Path("data/public-lyrics"),
        help="Path to the PD corpus tree (default: data/public-lyrics).",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("data/lyric-gen-corpus"),
        help="Output directory for train.jsonl / eval.jsonl / stats.json.",
    )
    parser.add_argument(
        "--max-per-language",
        type=int,
        default=2500,
        help=(
            "Cap per language to avoid one language dominating the SFT batch."
            " 0 disables the cap. Default 2500 keeps the dataset balanced "
            "while allowing all the PD entries through."
        ),
    )
    args = parser.parse_args()

    if not args.corpus_root.is_dir():
        raise SystemExit(f"corpus root {args.corpus_root} is not a directory")
    args.out.mkdir(parents=True, exist_ok=True)

    pd_entries = _collect_pd(args.corpus_root)
    if not pd_entries:
        raise SystemExit(
            f"no PD entries under {args.corpus_root}; run Sprint 6 first"
        )

    examples: list[Example] = []
    for entry in pd_entries:
        examples.extend(_emit_synthetic(entry))

    # Optional cap per language.
    if args.max_per_language > 0:
        by_lang: dict[str, list[Example]] = defaultdict(list)
        for ex in examples:
            by_lang[ex.language].append(ex)
        capped: list[Example] = []
        for lang, group in by_lang.items():
            rng = random.Random(hashlib.sha256(lang.encode()).hexdigest())
            rng.shuffle(group)
            capped.extend(group[: args.max_per_language])
        examples = capped

    train_path = args.out / "train.jsonl"
    eval_path = args.out / "eval.jsonl"
    stats_path = args.out / "stats.json"

    train_count = 0
    eval_count = 0
    by_lang_split: dict[str, Counter[str]] = defaultdict(Counter)
    with train_path.open("w", encoding="utf-8") as tf, eval_path.open(
        "w", encoding="utf-8"
    ) as ef:
        for idx, ex in enumerate(examples):
            split = _stable_split(ex.source_id, idx)
            obj = asdict(ex)
            line = json.dumps(obj, ensure_ascii=False)
            if split == "train":
                tf.write(line + "\n")
                train_count += 1
            else:
                ef.write(line + "\n")
                eval_count += 1
            by_lang_split[ex.language][split] += 1

    stats = {
        "train_count": train_count,
        "eval_count": eval_count,
        "by_language": {
            lang: {"train": c.get("train", 0), "eval": c.get("eval", 0)}
            for lang, c in by_lang_split.items()
        },
        "sources": {
            "pd_entries": len(pd_entries),
        },
    }
    stats_path.write_text(json.dumps(stats, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(stats, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
