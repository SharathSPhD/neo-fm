"""Beta-Bernoulli Thompson sampling over harness arms, per context (language or user).

Reward is a judge outcome against the current champion: win 1, tie 0.5, loss 0. Stdlib only; nothing here is
imported by the web app. The same class runs offline replay, simulation and (ported to TS) inside the CMA.
"""
from __future__ import annotations
import random
from dataclasses import dataclass, field


@dataclass
class Posterior:
    a: float = 1.0  # prior pseudo-wins
    b: float = 1.0  # prior pseudo-losses

    def update(self, reward: float, weight: float = 1.0) -> None:
        self.a += reward * weight
        self.b += (1.0 - reward) * weight

    def mean(self) -> float:
        return self.a / (self.a + self.b)

    def sample(self, rng: random.Random) -> float:
        return rng.betavariate(self.a, self.b)

    def p_better_than(self, p0: float, rng: random.Random, n: int = 4000) -> float:
        """P(true win rate > p0), by Monte Carlo (stdlib has no beta cdf)."""
        return sum(rng.betavariate(self.a, self.b) > p0 for _ in range(n)) / n


@dataclass
class Bandit:
    arms: list[str]
    prior: dict[str, tuple[float, float]] = field(default_factory=dict)
    seed: int = 0
    post: dict[str, Posterior] = field(init=False)

    def __post_init__(self) -> None:
        self.rng = random.Random(self.seed)
        self.post = {a: Posterior(*self.prior.get(a, (1.0, 1.0))) for a in self.arms}

    def choose(self) -> str:
        return max(self.arms, key=lambda a: self.post[a].sample(self.rng))

    def update(self, arm: str, reward: float, weight: float = 1.0) -> None:
        self.post[arm].update(reward, weight)

    def promote(self, arm: str, min_p: float = 0.9, min_n: float = 12.0) -> bool:
        """Promotion rule: enough judged battles AND high posterior mass above parity with the champion (0.5)."""
        p = self.post[arm]
        n = p.a + p.b - 2.0
        return n >= min_n and p.p_better_than(0.5, self.rng) >= min_p
