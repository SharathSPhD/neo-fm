"""Bradley-Terry ratings from pairwise outcomes, Elo-scaled, with a brief-clustered bootstrap.

A battle is (a, b, score_a, group): score_a in {1, 0.5, 0}; group is the brief id so the
bootstrap resamples whole briefs (battles on one brief are not independent).
"""
from __future__ import annotations

import math
import random
from collections import defaultdict

ELO_SCALE = 400 / math.log(10)
ELO_BASE = 1000.0

Battle = tuple[str, str, float, str]


def bradley_terry(battles: list[Battle], iters: int = 500, prior: float = 0.5) -> dict[str, float]:
    """Return log-strengths (mean 0). `prior` adds that many virtual draws between every pair so
    an undefeated or winless variant stays finite instead of diverging."""
    names = sorted({x for b in battles for x in b[:2]})
    if not names:
        return {}
    wins: dict[tuple[str, str], float] = defaultdict(float)
    for a, b, s, _ in battles:
        wins[(a, b)] += s
        wins[(b, a)] += 1 - s
    for i in names:
        for j in names:
            if i != j and prior:
                wins[(i, j)] += prior / 2
    p = {n: 1.0 for n in names}
    for _ in range(iters):
        new = {}
        for i in names:
            w = sum(wins[(i, j)] for j in names if j != i)
            d = sum((wins[(i, j)] + wins[(j, i)]) / (p[i] + p[j]) for j in names if j != i)
            new[i] = w / d if d else p[i]
        g = math.exp(sum(math.log(v) for v in new.values()) / len(new))
        new = {k: v / g for k, v in new.items()}
        delta = max(abs(math.log(new[k]) - math.log(p[k])) for k in names)
        p = new
        if delta < 1e-9:
            break
    return {k: math.log(v) for k, v in p.items()}


def to_elo(theta: dict[str, float], anchor: str | None = None) -> dict[str, float]:
    """Scale to Elo points; `anchor` (default: the weakest-mean-neutral zero) sits at 1000."""
    off = theta[anchor] if anchor in theta else 0.0
    return {k: ELO_BASE + ELO_SCALE * (v - off) for k, v in theta.items()}


def bootstrap(battles: list[Battle], rounds: int = 200, seed: int = 7, anchor: str | None = None):
    """Per-variant (low, high) 95% Elo interval and mean rank, resampling briefs."""
    rng = random.Random(seed)
    groups: dict[str, list[Battle]] = defaultdict(list)
    for b in battles:
        groups[b[3]].append(b)
    keys = list(groups)
    samples: dict[str, list[float]] = defaultdict(list)
    ranks: dict[str, list[int]] = defaultdict(list)
    for _ in range(rounds):
        draw = [b for k in (rng.choice(keys) for _ in keys) for b in groups[k]]
        elo = to_elo(bradley_terry(draw, iters=200), anchor)
        for rank, (name, v) in enumerate(sorted(elo.items(), key=lambda kv: -kv[1]), 1):
            samples[name].append(v)
            ranks[name].append(rank)
    out = {}
    for n, xs in samples.items():
        xs.sort()
        lo = xs[int(0.025 * (len(xs) - 1))]
        hi = xs[int(round(0.975 * (len(xs) - 1)))]
        out[n] = {"lo": lo, "hi": hi, "mean_rank": sum(ranks[n]) / len(ranks[n])}
    return out


def table(battles: list[Battle], anchor: str | None = None, rounds: int = 200) -> list[dict]:
    """Leaderboard rows sorted best first: elo, interval, battles, win rate, p(top)."""
    if not battles:
        return []
    elo = to_elo(bradley_terry(battles), anchor)
    ci = bootstrap(battles, rounds, anchor=anchor)
    n: dict[str, int] = defaultdict(int)
    pts: dict[str, float] = defaultdict(float)
    for a, b, s, _ in battles:
        n[a] += 1
        n[b] += 1
        pts[a] += s
        pts[b] += 1 - s
    rows = [
        {"variant": k, "elo": v, "lo": ci[k]["lo"], "hi": ci[k]["hi"], "mean_rank": ci[k]["mean_rank"],
         "battles": n[k], "winrate": pts[k] / n[k]}
        for k, v in elo.items()
    ]
    rows.sort(key=lambda r: -r["elo"])
    return rows


def beats(rows: list[dict], a: str, b: str) -> bool | None:
    """True when a's interval sits wholly above b's, False when wholly below, else None (unresolved)."""
    ra = next((r for r in rows if r["variant"] == a), None)
    rb = next((r for r in rows if r["variant"] == b), None)
    if not ra or not rb:
        return None
    if ra["lo"] > rb["hi"]:
        return True
    if ra["hi"] < rb["lo"]:
        return False
    return None
