"""Offline replay: turn the arena's real judged battles into per-language posteriors for a challenger arm.

Free: reads tools/arena/data/battles.jsonl, makes no model calls. Output is the data behind a per-language arm table.
    python3 replay.py [challenger] [champion]
"""
from __future__ import annotations
import json, sys
from collections import defaultdict
from pathlib import Path
from bandit import Posterior
import random

BATTLES = Path(__file__).resolve().parents[1] / "arena/data/battles.jsonl"


def per_language(challenger: str, champion: str, path: Path = BATTLES) -> dict[str, Posterior]:
    out: dict[str, Posterior] = defaultdict(Posterior)
    for line in path.read_text().splitlines():
        x = json.loads(line)
        if x["kind"] != "lyrics":
            continue
        if (x["a"], x["b"]) == (challenger, champion):
            r = x["score"]
        elif (x["a"], x["b"]) == (champion, challenger):
            r = 1.0 - x["score"]
        else:
            continue
        out[x["brief"].split("-")[0]].update(r)
    return dict(out)


def main() -> None:
    ch = sys.argv[1] if len(sys.argv) > 1 else "harness-refs"
    champ = sys.argv[2] if len(sys.argv) > 2 else "prod-haiku6-pce-sonnet-polish"
    rng = random.Random(0)
    print(f"{ch} vs {champ} (reward = judge win rate, ties 0.5)")
    for lang, p in sorted(per_language(ch, champ).items()):
        n = p.a + p.b - 2
        print(f"{lang}: n={n:.0f} mean={p.mean():.2f} P(>0.5)={p.p_better_than(0.5, rng):.2f}")


if __name__ == "__main__":
    main()
