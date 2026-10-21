"""Simulated environments to check that the learning loops work before any paid judging.

1. harness: arms with a hidden win rate against the champion, per language. Compares fixed A/B (equal split) with
   Thompson sampling on judged calls spent and on regret. Real judge calls cost money, so fewer wasted calls is the point.
2. taste: users with a hidden preference over styles, a population prior, and per-user shrinkage. Measures how many
   songs it takes to beat the population-best pick, and what a stated-taste prior buys at cold start.
    python3 sim.py
"""
from __future__ import annotations
import random
from bandit import Bandit


def run_harness(policy: str, truth: dict[str, float], budget: int, seed: int) -> tuple[float, str]:
    rng = random.Random(seed)
    arms = list(truth)
    b = Bandit(arms, seed=seed)
    best = max(truth.values())
    regret = 0.0
    for t in range(budget):
        arm = arms[t % len(arms)] if policy == "ab" else b.choose()
        r = 1.0 if rng.random() < truth[arm] else 0.0
        b.update(arm, r)
        regret += best - truth[arm]
    return regret, max(arms, key=lambda a: b.post[a].mean())


def run_taste(prior_style: str | None, truth: dict[str, float], songs: int, seed: int, prior_strength: float = 4.0) -> float:
    """Mean per-song like rate over `songs` songs for one user. prior_style = style the user said they like at onboarding."""
    rng = random.Random(seed)
    prior = {s: (1.0 + (prior_strength if s == prior_style else 0.0), 1.0) for s in truth}
    b = Bandit(list(truth), prior=prior, seed=seed)
    liked = 0
    for _ in range(songs):
        s = b.choose()
        r = 1.0 if rng.random() < truth[s] else 0.0
        b.update(s, r)
        liked += r
    return liked / songs


def main() -> None:
    truth = {"live": 0.50, "refs": 0.62, "refs6": 0.58, "romanize": 0.55}
    for pol in ("ab", "thompson"):
        res = [run_harness(pol, truth, 80, s) for s in range(300)]
        reg = sum(r for r, _ in res) / len(res)
        right = sum(w == "refs" for _, w in res) / len(res)
        print(f"harness {pol:9s} regret/80 calls={reg:5.1f} picks true best={right:.0%}")
    styles = {"ghazal": 0.75, "pop": 0.40, "folk": 0.35, "rock": 0.20}
    rng = random.Random(1)
    for name, ps in (("no prior", None), ("stated taste", "ghazal"), ("wrong stated taste", "rock")):
        r = [run_taste(ps, styles, 30, s) for s in range(400)]
        print(f"taste {name:19s} like rate over first 30 songs={sum(r)/len(r):.2f} (oracle 0.75, uniform 0.43)")


if __name__ == "__main__":
    main()
