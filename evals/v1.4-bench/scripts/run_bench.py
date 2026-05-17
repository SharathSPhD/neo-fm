"""Enqueue bench prompts through the v1.4 worker for candidate generation.

Each prompt is materialised as `top-n` candidate WAVs under a fresh
run directory. This script is the *dispatcher*: it writes the run
manifest, prepares each candidate's payload, and writes
placeholders the worker / DGX render step can fill in. Actual rendering
happens on the GB10 box and is invoked by `services/dgx-worker`.

We deliberately keep this dry-run safe: when --dry-run (default) is
passed, the manifest lists every prompt × seed combination and writes
empty `.wav.placeholder` files so downstream tooling (score_run,
test harnesses) can be exercised in CI without GPU.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))

from bench_loader import Prompt, load_all  # noqa: E402

BENCH_ROOT = THIS_DIR.parent
RUNS_DIR = BENCH_ROOT / "runs"


def _seed_for(prompt_id: str, n: int) -> int:
    # Deterministic seed per prompt × candidate index. We avoid time-
    # based seeds so re-runs in CI produce the same manifest.
    h = abs(hash(prompt_id)) & 0xFFFFFFFF
    return (h + n * 1_000_003) & 0xFFFFFFFF


def build_manifest(
    prompts: list[Prompt],
    *,
    top_n: int,
    engine: str,
) -> dict[str, object]:
    rows: list[dict[str, object]] = []
    for prompt in prompts:
        for k in range(top_n):
            rows.append(
                {
                    "prompt_id": prompt.id,
                    "style": prompt.style,
                    "language": prompt.language,
                    "candidate_index": k,
                    "seed": _seed_for(prompt.id, k),
                    "lyrics_seed": prompt.lyrics_seed,
                    "expected": asdict(prompt.expected),
                    "duration_seconds": prompt.duration_seconds,
                    "engine": engine,
                    "voice_persona": prompt.expected.voice_persona,
                },
            )
    return {
        "engine": engine,
        "top_n": top_n,
        "prompt_count": len(prompts),
        "candidate_count": len(rows),
        "generated_at": datetime.now(UTC).isoformat(),
        "candidates": rows,
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Dispatch the v1.4 bench (100 prompts × top-N candidates)",
    )
    p.add_argument(
        "--engine",
        default="current",
        help="engine label baked into the run manifest (e.g. 'current', 'heartmula-bhavageete-lora', 'musicgen-carnatic')",
    )
    p.add_argument(
        "--top-n",
        type=int,
        default=4,
        help="candidates per prompt (default: 4)",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="write manifest + placeholder candidate files; do not enqueue",
    )
    p.add_argument(
        "--apply",
        action="store_true",
        help="dispatch to the worker (DGX-only). Mutually exclusive with --dry-run",
    )
    args = p.parse_args(argv)
    if args.apply:
        args.dry_run = False

    prompts = load_all()
    manifest = build_manifest(prompts, top_n=args.top_n, engine=args.engine)

    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    run_dir = RUNS_DIR / f"{stamp}-{args.engine}"
    run_dir.mkdir(parents=True, exist_ok=True)
    candidates_dir = run_dir / "candidates"
    candidates_dir.mkdir(exist_ok=True)

    (run_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )

    if args.dry_run:
        for row in manifest["candidates"]:  # type: ignore[union-attr]
            assert isinstance(row, dict)
            placeholder = (
                candidates_dir
                / f"{row['prompt_id']}-seed{row['seed']:08x}.wav.placeholder"
            )
            placeholder.write_text(
                json.dumps(row, indent=2) + "\n",
                encoding="utf-8",
            )
        print(
            f"dry-run: wrote manifest + "
            f"{len(manifest['candidates'])} placeholders to {run_dir}",  # type: ignore[arg-type]
        )
        return 0

    # --apply path is DGX-only; the actual render call lives in the
    # dgx-worker. We load bench_dispatch.py by file path so this
    # script does not need services.dgx_worker on sys.path.
    import importlib.util

    worker_path = (
        Path(__file__).resolve().parent.parent.parent.parent
        / "services"
        / "dgx-worker"
        / "app"
        / "bench_dispatch.py"
    )
    spec = importlib.util.spec_from_file_location(
        "_neo_dgx_bench_dispatch", worker_path,
    )
    if spec is None or spec.loader is None:
        print(
            f"--apply could not load {worker_path}",
            file=sys.stderr,
        )
        return 2
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.dispatch(manifest, run_dir=run_dir)
    print(f"apply: dispatched {len(manifest['candidates'])} candidates to {run_dir}")  # type: ignore[arg-type]
    return 0


if __name__ == "__main__":
    sys.exit(main())
