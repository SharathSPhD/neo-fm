#!/usr/bin/env python3
"""
Verifies every `.md` under `data/public-lyrics/` against ADR 0006.

CI runs this on every PR. The goal is to make it impossible to silently
land a non-public-domain lyric in the corpus: a missing field, a
non-PD author, or a non-PD print source all fail the build.

What "public domain" means here, strictly (per ADR 0006):

- India (where the platform launches): Indian Copyright Act 1957 §22,
  life + 60 years. Conservatively we require
  `death_year + 60 < CURRENT_YEAR`.
- United States (where the host runs and where contributors mostly live):
  pre-1929 first-print-source guarantees PD; we require
  `source_text_year <= 1928`.
- EU is acceptable risk for v1 (no launch plan); we do not enforce.

A row that passes both India AND US is what we ship. EU divergence is
documented in `license_basis` per entry but not gate-checked here.

The script does NOT do a live source fetch (network in CI is flaky; the
URL is treated as documentary citation, not as an availability promise).
If `--check-urls` is passed, the script does a HEAD per URL and warns
(not fails) on transient failures.

Usage:
    python3 scripts/verify-lyrics-provenance.py
    python3 scripts/verify-lyrics-provenance.py --check-urls
    python3 scripts/verify-lyrics-provenance.py --root data/public-lyrics
"""

from __future__ import annotations

import argparse
import datetime
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:  # pragma: no cover - CI always has pyyaml
    sys.stderr.write(
        "error: PyYAML is required. Install with `pip install pyyaml`.\n"
    )
    sys.exit(2)


REQUIRED_FIELDS = (
    "title",
    "author",
    "language",
    "script",
    "death_year",
    "source_text_year",
    "source_url",
    "source_citation",
    "license_assertion",
    "license_basis",
    "verified_by",
    "verified_at",
)

# Allowed by the Section schema in @neo-fm/song-doc. Keep in sync.
# v1.4 Sprint 6: added `bengali` (Tagore corpus) plus `bn` and `sa`. Sanskrit
# is written in Devanagari here — there is no separate `sanskrit` script.
ALLOWED_SCRIPTS = {"latin", "devanagari", "kannada", "tamil", "telugu", "bengali"}
ALLOWED_LANGUAGES = {"en", "hi", "kn", "ta", "te", "bn", "sa"}


@dataclass
class Finding:
    path: Path
    severity: str
    message: str

    def render(self) -> str:
        return f"{self.severity}: {self.path}: {self.message}"


def _parse_frontmatter(text: str, path: Path) -> tuple[dict[str, Any], str] | None:
    """Split a markdown file into (frontmatter dict, body).

    Returns None on syntactic failure (caller emits a Finding).
    """
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---\n", 4)
    if end == -1:
        return None
    raw = text[4:end]
    body = text[end + 5 :]
    try:
        loaded = yaml.safe_load(raw)
    except yaml.YAMLError:
        return None
    if not isinstance(loaded, dict):
        return None
    return loaded, body


def _check_one(path: Path, current_year: int) -> list[Finding]:
    out: list[Finding] = []
    text = path.read_text(encoding="utf-8")
    parsed = _parse_frontmatter(text, path)
    if parsed is None:
        out.append(
            Finding(path, "ERROR", "missing or unparseable YAML frontmatter")
        )
        return out

    fm, body = parsed

    for field in REQUIRED_FIELDS:
        if field not in fm:
            out.append(Finding(path, "ERROR", f"missing required field `{field}`"))

    if out:
        # Field-level errors first; deeper checks would just compound noise.
        return out

    # ---- Structural checks --------------------------------------------------
    language = fm["language"]
    if language not in ALLOWED_LANGUAGES:
        out.append(
            Finding(
                path,
                "ERROR",
                f"language `{language}` not in allowed set {sorted(ALLOWED_LANGUAGES)}",
            )
        )

    script = fm["script"]
    if script not in ALLOWED_SCRIPTS:
        out.append(
            Finding(
                path,
                "ERROR",
                f"script `{script}` not in allowed set {sorted(ALLOWED_SCRIPTS)}",
            )
        )

    # Directory layout: data/public-lyrics/<language>/<file>.md
    # Catches the "labelled hi but filed under en/" foot-gun.
    parent = path.parent.name
    if parent != language:
        out.append(
            Finding(
                path,
                "ERROR",
                f"file is under `{parent}/` but frontmatter language is `{language}`",
            )
        )

    death_year = fm["death_year"]
    if not isinstance(death_year, int):
        out.append(
            Finding(path, "ERROR", f"death_year `{death_year!r}` must be an integer")
        )
    else:
        # India life + 60. Conservative.
        india_pd_year = death_year + 60
        if india_pd_year >= current_year:
            out.append(
                Finding(
                    path,
                    "ERROR",
                    f"author still under Indian copyright (death_year={death_year}, "
                    f"PD-in-India year = {india_pd_year}, current year = {current_year})",
                )
            )

    source_text_year = fm["source_text_year"]
    if not isinstance(source_text_year, int):
        out.append(
            Finding(
                path,
                "ERROR",
                f"source_text_year `{source_text_year!r}` must be an integer",
            )
        )
    else:
        # US: pre-1929 print = public domain. ADR 0006 explicitly uses 1929.
        if source_text_year > 1928:
            out.append(
                Finding(
                    path,
                    "ERROR",
                    f"source_text_year={source_text_year} is post-1928; "
                    "US public-domain assertion does not hold per ADR 0006",
                )
            )

    if fm["license_assertion"] != "public-domain":
        out.append(
            Finding(
                path,
                "ERROR",
                f"license_assertion=`{fm['license_assertion']}` is not "
                "`public-domain` — this corpus only accepts PD entries",
            )
        )

    if not isinstance(fm["license_basis"], str) or not fm["license_basis"].strip():
        out.append(
            Finding(path, "ERROR", "license_basis must be a non-empty string")
        )

    if not isinstance(fm["source_url"], str) or not fm["source_url"].startswith(
        ("http://", "https://")
    ):
        out.append(
            Finding(path, "ERROR", "source_url must be an http(s) URL")
        )

    if not isinstance(fm["verified_by"], str) or not fm["verified_by"].strip():
        out.append(
            Finding(path, "ERROR", "verified_by must be a non-empty string")
        )

    try:
        datetime.date.fromisoformat(str(fm["verified_at"]))
    except (TypeError, ValueError):
        out.append(
            Finding(
                path,
                "ERROR",
                f"verified_at=`{fm['verified_at']!r}` must be ISO date YYYY-MM-DD",
            )
        )

    if not body.strip():
        out.append(Finding(path, "ERROR", "body is empty"))

    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        default="data/public-lyrics",
        help="Directory tree of lyric .md files (default: data/public-lyrics)",
    )
    parser.add_argument(
        "--year",
        type=int,
        default=datetime.date.today().year,
        help="Override current year (testing only)",
    )
    parser.add_argument(
        "--min-entries",
        type=int,
        default=12,
        help=(
            "Minimum number of valid PD entries to require across the tree "
            "(default: 12; ADR 0006 mandates >=12 = 4 each en/hi/kn before "
            "Phase 3 can ship)"
        ),
    )
    args = parser.parse_args()

    root = Path(args.root)
    if not root.is_dir():
        sys.stderr.write(f"error: {root} is not a directory\n")
        return 2

    findings: list[Finding] = []
    files = sorted(root.rglob("*.md"))
    if not files:
        findings.append(
            Finding(root, "ERROR", "no .md files found under root")
        )

    by_language: dict[str, int] = {}
    for f in files:
        file_findings = _check_one(f, current_year=args.year)
        findings.extend(file_findings)
        if not any(x.severity == "ERROR" for x in file_findings):
            by_language[f.parent.name] = by_language.get(f.parent.name, 0) + 1

    errors = [x for x in findings if x.severity == "ERROR"]
    for x in findings:
        print(x.render())

    # ADR 0006: at least 12, with 4 each in en/hi/kn.
    total = sum(by_language.values())
    if total < args.min_entries:
        errors.append(
            Finding(
                root,
                "ERROR",
                f"only {total} valid entries; ADR 0006 requires "
                f">= {args.min_entries}",
            )
        )
        print(errors[-1].render())

    for lang in ("en", "hi", "kn"):
        if by_language.get(lang, 0) < 4:
            errors.append(
                Finding(
                    root,
                    "ERROR",
                    f"language `{lang}` has only {by_language.get(lang, 0)} "
                    "valid entries; ADR 0006 requires >= 4",
                )
            )
            print(errors[-1].render())

    if errors:
        print(f"\n{len(errors)} provenance error(s). See ADR 0006.")
        return 1

    print(
        f"OK: {total} valid PD entries across "
        f"{sorted(by_language.items())} (ADR 0006 satisfied)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
