"""Cloud-port embedder: deterministic signed-hash character/word n-gram vectors (numpy only).

The original uses sentence-transformers (all-MiniLM-L6-v2), which needs torch and a model download.
The Managed Agents sandbox has numpy/scipy but no package index or model hub, so this embedder is a
*lexical* stand-in: same interface (L2-normalised float32, `encode`, `cosine`, `dim`), reproducible,
script-agnostic (works for Kannada/Tamil/Devanagari as plain code points). It captures surface
overlap, not semantics -- see FIDELITY.md. Swap in a real model behind the same class to upgrade.
"""
from __future__ import annotations

import hashlib
import re
from typing import overload

import numpy as np
import numpy.typing as npt

DEFAULT_MODEL_ID = "hash-ngram-512"
_TOKEN = re.compile(r"\w+", re.UNICODE)


def _slot(feature: str, dim: int) -> tuple[int, float]:
    h = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
    n = int.from_bytes(h, "little")
    return n % dim, 1.0 if (n >> 63) & 1 else -1.0


class Embedder:
    def __init__(self, model_id: str = DEFAULT_MODEL_ID, dim: int = 512) -> None:
        self.model_id = model_id
        self.dim = dim

    def _one(self, text: str) -> npt.NDArray[np.float32]:
        v = np.zeros(self.dim, dtype=np.float32)
        words = [w.lower() for w in _TOKEN.findall(text)]
        for w in words:
            i, s = _slot("w:" + w, self.dim)
            v[i] += 1.5 * s
            padded = f"^{w}$"
            for n in (2, 3, 4):
                for k in range(len(padded) - n + 1):
                    i, s = _slot(f"c{n}:" + padded[k : k + n], self.dim)
                    v[i] += s
        for a, b in zip(words, words[1:]):
            i, s = _slot(f"b:{a}_{b}", self.dim)
            v[i] += s
        norm = float(np.linalg.norm(v))
        if norm > 0:
            v /= norm
        return v

    @overload
    def encode(self, text: str) -> npt.NDArray[np.float32]: ...
    @overload
    def encode(self, text: list[str]) -> npt.NDArray[np.float32]: ...

    def encode(self, text: str | list[str]) -> npt.NDArray[np.float32]:
        if isinstance(text, str):
            return self._one(text)
        items = list(text)
        if not items or any(not isinstance(t, str) for t in items):
            raise ValueError("Embedder.encode requires a string or list[str]")
        return np.stack([self._one(t) for t in items]).astype(np.float32)

    def cosine(self, a: npt.NDArray[np.float32], b: npt.NDArray[np.float32]) -> float:
        if a.shape != b.shape:
            raise ValueError(f"Embedder.cosine shape mismatch: {a.shape} vs {b.shape}")
        return float(np.dot(a, b))
