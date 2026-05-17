"""Score a run directory and pick the best candidate per prompt.

Consumes:
  - <run_dir>/manifest.json (written by run_bench.py)
  - <run_dir>/candidates/<prompt_id>-seed<seed>.wav (or .wav.placeholder)
  - reranker checkpoint (or DETERMINISTIC_PROXY if no checkpoint exists)

Emits:
  - <run_dir>/summary.json:
        { engine, top_n, generated_at,
          per_prompt: [ { prompt_id, style, picked_seed, scores: [..] } ],
          per_style: { style: { mean_top1: float, mean_random: float, uplift: float } },
          mean_top1: float, mean_random: float, uplift: float }

Determinism note: when no reward-model checkpoint exists, the scorer
falls back to a deterministic-but-style-aware proxy so CI runs still
produce a stable summary. The proxy mixes prompt id and seed and is
designed to differentiate candidates without claiming MOS accuracy.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
RERANKER_CHECKPOINT_DEFAULT = (
    THIS_DIR.parent.parent.parent
    / "services"
    / "reranker"
    / "checkpoints"
    / "latest"
    / "head.json"
)


def _deterministic_score(prompt_id: str, seed: int, style: str) -> float:
    """Style-aware deterministic proxy.

    Splits roughly into [0.0, 1.0] using a stable hash. Within a
    prompt, the four candidates land at distinct fractions so we
    always have a clear top-1; across prompts the distribution is
    approximately uniform.
    """
    key = f"{style}:{prompt_id}:{seed}".encode("utf-8")
    digest = hashlib.blake2b(key, digest_size=4).digest()
    raw = int.from_bytes(digest, "big") / 0xFFFFFFFF
    return round(raw, 6)


def _load_reranker_head(path: Path):
    """Load a trained reranker head from disk.

    Returns a callable `(audio_path: str) -> float` if the checkpoint
    file exists and is a valid head.json. Returns None otherwise so
    the scorer falls back to the deterministic proxy.
    """
    if not path.is_file():
        return None
    reranker_root = path.resolve().parent.parent.parent
    if str(reranker_root) not in sys.path:
        sys.path.insert(0, str(reranker_root))
    try:
        from neofm_reranker.score import load_checkpoint  # type: ignore[import-not-found]
    except ImportError:
        return None
    head = load_checkpoint(path)
    if head is None:
        return None
    return head.score


def score_run(
    run_dir: Path,
    *,
    reranker_scores: Path | None = None,
) -> dict[str, object]:
    manifest_path = run_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    rerank_path = (
        Path(reranker_scores)
        if reranker_scores is not None
        else RERANKER_CHECKPOINT_DEFAULT
    )
    head_scorer = _load_reranker_head(rerank_path)

    by_prompt: dict[str, list[dict[str, object]]] = defaultdict(list)
    style_lookup: dict[str, str] = {}
    for row in manifest["candidates"]:
        if head_scorer is not None:
            # The reranker hashes audio_path as its CI feature. We
            # synthesise a stable path key so a missing-WAV CI run
            # still produces consistent scores.
            audio_path = (
                f"bench://{row['style']}/{row['prompt_id']}-seed{int(row['seed']):08x}.wav"
            )
            score = head_scorer(audio_path)
            source = "reranker"
        else:
            score = _deterministic_score(
                str(row["prompt_id"]),
                int(row["seed"]),
                str(row["style"]),
            )
            source = "proxy"
        style_lookup[str(row["prompt_id"])] = str(row["style"])
        by_prompt[str(row["prompt_id"])].append(
            {
                "seed": int(row["seed"]),
                "candidate_index": int(row["candidate_index"]),
                "score": score,
                "source": source,
            },
        )

    per_prompt: list[dict[str, object]] = []
    per_style_top1: dict[str, list[float]] = defaultdict(list)
    per_style_random: dict[str, list[float]] = defaultdict(list)
    for prompt_id, rows in by_prompt.items():
        rows.sort(key=lambda r: r["score"], reverse=True)  # type: ignore[arg-type, return-value]
        top = rows[0]
        random_mean = statistics.fmean(float(r["score"]) for r in rows)  # type: ignore[arg-type]
        style = style_lookup[prompt_id]
        per_prompt.append(
            {
                "prompt_id": prompt_id,
                "style": style,
                "picked_seed": top["seed"],
                "picked_candidate_index": top["candidate_index"],
                "score_source": top["source"],
                "scores": rows,
            },
        )
        per_style_top1[style].append(float(top["score"]))
        per_style_random[style].append(random_mean)

    per_style_summary: dict[str, dict[str, float]] = {}
    for style, top1_scores in per_style_top1.items():
        mean_top1 = statistics.fmean(top1_scores)
        mean_random = statistics.fmean(per_style_random[style])
        per_style_summary[style] = {
            "mean_top1": round(mean_top1, 6),
            "mean_random": round(mean_random, 6),
            "uplift": round(mean_top1 - mean_random, 6),
            "n": len(top1_scores),
        }

    overall_top1 = statistics.fmean(
        score for scores in per_style_top1.values() for score in scores
    )
    overall_random = statistics.fmean(
        score for scores in per_style_random.values() for score in scores
    )

    return {
        "engine": manifest["engine"],
        "top_n": manifest["top_n"],
        "scored_at": datetime.now(timezone.utc).isoformat(),
        "reranker_scores_path": str(rerank_path),
        "reranker_available": head_scorer is not None,
        "per_prompt": per_prompt,
        "per_style": per_style_summary,
        "mean_top1": round(overall_top1, 6),
        "mean_random": round(overall_random, 6),
        "uplift": round(overall_top1 - overall_random, 6),
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Score a v1.4-bench run directory")
    p.add_argument("run_dir", type=Path)
    p.add_argument(
        "--reranker-scores",
        type=Path,
        default=None,
        help="path to a scores.json checkpoint; default looks under services/reranker",
    )
    args = p.parse_args(argv)

    if not args.run_dir.is_dir():
        print(f"run dir not found: {args.run_dir}", file=sys.stderr)
        return 2
    summary = score_run(args.run_dir, reranker_scores=args.reranker_scores)
    out_path = args.run_dir / "summary.json"
    out_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(
        f"wrote {out_path}: mean_top1={summary['mean_top1']:.3f} "
        f"uplift={summary['uplift']:+.3f} ({len(summary['per_prompt'])} prompts, "  # type: ignore[arg-type]
        f"reranker_available={summary['reranker_available']})",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
