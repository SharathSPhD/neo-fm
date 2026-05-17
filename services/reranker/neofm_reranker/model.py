"""Reward-model architecture for the v1.4 reranker.

Two-layer MLP head over a frozen audio encoder. The encoder lives on
DGX (MERT-95M); for CI / unit tests, a deterministic random feature
extractor stands in so we never need to load real audio.

Design constraint: the *exact* head architecture must round-trip
between Python and a JSON scores file so the eval scaffold can consume
checkpoints without importing torch.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass

ENCODER_DIM = 768  # MERT-95M output dimension.


@dataclass(frozen=True)
class HeadConfig:
    """MLP head config. ~50k trainable params when in_dim=768, hidden=64."""

    in_dim: int = ENCODER_DIM
    hidden_dim: int = 64
    dropout: float = 0.1
    init_seed: int = 0x4E454F46

    @property
    def parameter_count(self) -> int:
        # Linear(in -> hidden) + Linear(hidden -> 1) with biases.
        return (
            (self.in_dim * self.hidden_dim)
            + self.hidden_dim
            + (self.hidden_dim * 1)
            + 1
        )


def _deterministic_features(audio_path: str) -> list[float]:
    """Generate a stable feature vector for an audio path.

    Used in tests and as a fallback when MERT-95M is not available
    (CI). We chain SHA-256 (32 bytes/16 fp16-equivalent floats per
    call) until we have ENCODER_DIM values in [-1, 1]. Blake2b would
    be more elegant but its digest size caps at 64 bytes.
    """
    seed = audio_path.encode("utf-8")
    needed_bytes = ENCODER_DIM * 2
    chunks: list[bytes] = []
    counter = 0
    while sum(len(c) for c in chunks) < needed_bytes:
        chunks.append(
            hashlib.sha256(seed + counter.to_bytes(4, "big")).digest(),
        )
        counter += 1
    digest = b"".join(chunks)[:needed_bytes]
    features: list[float] = []
    for i in range(ENCODER_DIM):
        byte_pair = digest[i * 2 : (i + 1) * 2]
        raw = int.from_bytes(byte_pair, "big") / 0xFFFF
        features.append(round((raw * 2.0) - 1.0, 6))
    return features


@dataclass
class RerankerHead:
    """Tiny, dependency-free reward head.

    Stores weights as nested lists rather than ndarrays so the
    checkpoint can serialise to JSON cleanly.
    """

    config: HeadConfig
    w1: list[list[float]]
    b1: list[float]
    w2: list[float]
    b2: float

    @classmethod
    def from_config(cls, config: HeadConfig) -> "RerankerHead":
        # Glorot init seeded off config.init_seed so two calls with
        # the same config produce identical weights.
        rng_state = config.init_seed & 0xFFFFFFFF

        def next_uniform(lo: float, hi: float) -> float:
            nonlocal rng_state
            # xorshift32
            x = rng_state
            x ^= (x << 13) & 0xFFFFFFFF
            x ^= (x >> 17) & 0xFFFFFFFF
            x ^= (x << 5) & 0xFFFFFFFF
            rng_state = x & 0xFFFFFFFF
            frac = rng_state / 0xFFFFFFFF
            return lo + (hi - lo) * frac

        limit1 = math.sqrt(6.0 / (config.in_dim + config.hidden_dim))
        limit2 = math.sqrt(6.0 / (config.hidden_dim + 1))
        w1 = [
            [next_uniform(-limit1, limit1) for _ in range(config.hidden_dim)]
            for _ in range(config.in_dim)
        ]
        b1 = [0.0] * config.hidden_dim
        w2 = [next_uniform(-limit2, limit2) for _ in range(config.hidden_dim)]
        b2 = 0.0
        return cls(config=config, w1=w1, b1=b1, w2=w2, b2=b2)

    def forward(self, features: list[float]) -> float:
        if len(features) != self.config.in_dim:
            raise ValueError(
                f"expected {self.config.in_dim} features, got {len(features)}",
            )
        hidden = [0.0] * self.config.hidden_dim
        for j in range(self.config.hidden_dim):
            acc = self.b1[j]
            for i in range(self.config.in_dim):
                acc += features[i] * self.w1[i][j]
            hidden[j] = max(0.0, acc)  # ReLU
        out = self.b2
        for j in range(self.config.hidden_dim):
            out += hidden[j] * self.w2[j]
        return out

    def score(self, audio_path: str) -> float:
        features = _deterministic_features(audio_path)
        return self.forward(features)
