"""Curate a Tamil-folk vocal+accompaniment corpus for v1.4 Sprint 9.

Tamil-folk specialisation of the shared pipeline in
`_corpus_pipeline.py`. Same recipe as bhavageete, different language
(`ta`) and source landscape:

  - **Tamil Nadu folk festival recordings** — district-level Pongal /
    Vaikasi Visakam / village deity festivals released CC-BY by the
    Tamil Nadu Folklore Foundation and similar archives.
  - **Saraga Tamil-folk** subset (CompMusic, CC-BY-NC-SA — if/when
    available; check `data/tamil-folk-sources.yaml` for current
    inclusions).
  - **YouTube CC commons** filtered via `yt-dlp --match-filter
    "license=cc-by"` for parai-driven janapada repertoire.
  - **British Library Sounds** Tamil folk recordings — older
    fieldwork releases under CC-BY-NC-SA.

The target style is anhemitonic-pentatonic Tamil janapada with
parai / thavil / nadaswaram instrumentation. Bhavageete-style soft
harmonium-and-tabla beds are *not* in this corpus — caption-stage
reviewers reject them so the LoRA doesn't blur back into light pop.

CLI mirrors curate_bhavageete (same `--stage` set, same `--dry-run`).

References:
- ADR 0029 (v1.4 Sprint 9): Tamil-folk LoRA on HeartMuLa.
- AGENTS.md "Compute rule (v1.4+)": GPU work runs on DGX Spark.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

from _corpus_pipeline import (
    SourceClip,
    emit_manifest_summary,
    load_manifest,
    validate_manifest,
)

LOG = logging.getLogger("curate_tamil_folk")

EXPECTED_LANGUAGE = "ta"

# Tamil-folk leans on CC-BY festival recordings + Saraga + BL Sounds.
# AIR fair-use clips are far less common here (Tamil-folk wasn't the
# AIR Bengaluru focus); we still allow fair-use-§52 in case the
# operator imports a few All India Radio Chennai pre-1972 broadcasts.
ALLOWED_LICENSES: frozenset[str] = frozenset(
    {"pd-india", "pd-us", "cc-by", "cc-by-sa", "cc-by-nc-sa", "fair-use-§52"}
)


def run_dry(manifest_path: Path, out_dir: Path) -> dict[str, Any]:
    clips: list[SourceClip] = load_manifest(manifest_path)
    validate_manifest(
        clips,
        expected_language=EXPECTED_LANGUAGE,
        allowed_licenses=ALLOWED_LICENSES,
    )
    return emit_manifest_summary(clips, out_dir)


def run_full(manifest_path: Path, out_dir: Path, *, stage: str) -> dict[str, Any]:  # pragma: no cover
    if stage in ("all", "validate"):
        return run_dry(manifest_path, out_dir)
    raise NotImplementedError(
        f"Stage {stage!r} is operator-driven on DGX. See docs/DECISIONS/0029 "
        f"for the runbook. Use --dry-run to validate the manifest in CI."
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Curate Tamil-folk corpus for v1.4 Sprint 9."
    )
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--stage",
        choices=[
            "validate",
            "download",
            "segment",
            "vad",
            "align",
            "caption",
            "export",
            "all",
        ],
        default="validate",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()

    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    if args.dry_run or args.stage == "validate":
        summary = run_dry(args.manifest, args.out)
    else:
        summary = run_full(args.manifest, args.out, stage=args.stage)
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
