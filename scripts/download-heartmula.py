#!/usr/bin/env python3
"""Download HeartMuLa weights into HEARTMULA_CKPT_DIR.

Mirrors the layout the heartlib quickstart README expects:

    $HEARTMULA_CKPT_DIR/
    └── ckpt/
        ├── HeartCodec-oss/             (from HeartMuLa/HeartCodec-oss-20260123)
        ├── HeartMuLa-oss-3B/           (from HeartMuLa/HeartMuLa-oss-3B-happy-new-year)
        ├── gen_config.json             (from HeartMuLa/HeartMuLaGen)
        └── tokenizer.json              (from HeartMuLa/HeartMuLaGen)

The script is idempotent: each `snapshot_download` is skipped when the
revision file already exists locally.

Environment:
    HEARTMULA_CKPT_DIR   (default: /mnt/models/heartmula)
    HF_TOKEN             (required for some gated configs; the
                          three repos here are public but a token
                          dramatically reduces 429s on first run)

Usage:
    HF_TOKEN=hf_xxx python scripts/download-heartmula.py
    python scripts/download-heartmula.py --dry-run     # print what would be pulled
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


# Pinned ids per heartlib README. Update when the upstream rotates.
REPOS = [
    ("HeartMuLa/HeartMuLaGen", "ckpt"),
    ("HeartMuLa/HeartMuLa-oss-3B-happy-new-year", "ckpt/HeartMuLa-oss-3B"),
    ("HeartMuLa/HeartCodec-oss-20260123", "ckpt/HeartCodec-oss"),
]


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument(
        "--root",
        type=Path,
        default=Path(os.environ.get("HEARTMULA_CKPT_DIR", "/mnt/models/heartmula")),
        help="Local root for the model bundle. Default: %(default)s",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the target paths without downloading.",
    )
    p.add_argument(
        "--allow-patterns",
        nargs="*",
        default=None,
        help=(
            "Restrict each repo to a glob pattern (e.g. '*.safetensors'). "
            "Useful if you only need the inference weights."
        ),
    )
    return p.parse_args()


def main() -> int:
    args = _parse_args()
    root: Path = args.root
    root.mkdir(parents=True, exist_ok=True)

    print(f"target root: {root}", file=sys.stderr)

    if args.dry_run:
        for repo_id, rel in REPOS:
            print(f"  {repo_id:60s} -> {root / rel}", file=sys.stderr)
        return 0

    try:
        from huggingface_hub import snapshot_download  # type: ignore[import-not-found]
    except ImportError:
        print(
            "huggingface_hub is not installed. Install with:\n"
            "    pip install 'huggingface_hub>=0.25'",
            file=sys.stderr,
        )
        return 2

    token = os.environ.get("HF_TOKEN") or None  # snapshot_download accepts None

    for repo_id, rel in REPOS:
        target = root / rel
        target.mkdir(parents=True, exist_ok=True)
        print(f"downloading {repo_id} -> {target}", file=sys.stderr)
        snapshot_download(
            repo_id=repo_id,
            local_dir=str(target),
            allow_patterns=args.allow_patterns,
            token=token,
            local_dir_use_symlinks=False,
        )

    print("all weights present.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
