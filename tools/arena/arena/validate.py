"""Check a judge against an independent signal before its verdicts are used for selection or ranking.

Two checks, both free once the judge's outputs exist:
- pointwise: rank correlation between a judge score (e.g. Gemini 'overall') and a reference signal
  (e.g. sung-word diction match) over the same items;
- pairwise: for pairs where the reference signal clearly separates the two sides, how often the judge
  (in both orders) picks the side the reference prefers, with an exact binomial interval.
A judge that cannot hear the reference axis will sit near 50% / rho 0; that is a finding, not a bug.
"""
from __future__ import annotations

import math


def _rank(xs: list[float]) -> list[float]:
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def spearman(a: list[float], b: list[float]) -> float:
    ra, rb = _rank(a), _rank(b)
    ma, mb = sum(ra) / len(ra), sum(rb) / len(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    den = math.sqrt(sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb))
    return num / den if den else 0.0


def spearman_ci(a: list[float], b: list[float], rounds: int = 2000, seed: int = 11) -> tuple[float, float]:
    import random
    rng = random.Random(seed)
    n, vals = len(a), []
    for _ in range(rounds):
        idx = [rng.randrange(n) for _ in range(n)]
        vals.append(spearman([a[i] for i in idx], [b[i] for i in idx]))
    vals.sort()
    return vals[int(0.025 * (rounds - 1))], vals[int(round(0.975 * (rounds - 1)))]


def binom_ci(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson interval; fine for the small n here and never outside [0, 1]."""
    if n == 0:
        return 0.0, 1.0
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


def pairwise_agreement(pairs: list[dict], gap: float = 10.0) -> dict:
    """pairs: {a_ref, b_ref, pick: 'a'|'b'|'split'}; pick='split' means the two orders disagreed.
    Only pairs whose reference gap >= `gap` count; ties/splits are reported, not hidden."""
    use = [p for p in pairs if abs(p["a_ref"] - p["b_ref"]) >= gap]
    split = sum(p["pick"] == "split" for p in use)
    dec = [p for p in use if p["pick"] != "split"]
    agree = sum((p["pick"] == "a") == (p["a_ref"] > p["b_ref"]) for p in dec)
    lo, hi = binom_ci(agree, len(dec))
    return {"pairs": len(pairs), "separated": len(use), "decisive": len(dec), "split": split, "agree": agree,
            "rate": agree / len(dec) if dec else None, "ci": (round(lo, 2), round(hi, 2))}
