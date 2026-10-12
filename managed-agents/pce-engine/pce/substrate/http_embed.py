"""Embedder backed by the neo-fm embedding service (multilingual-e5-small on Cloud Run).

Same interface as the lexical stand-in. Raw e5 cosines are compressed into ~[0.7, 0.9] (anisotropy), which would
flatten every threshold in the operators, so vectors are mean-centred on a fixed multilingual reference set and
re-normalised: cosine then spreads over roughly [-0.5, 1].
Env: EMBED_URL, EMBED_TOKEN.
"""
from __future__ import annotations

import json
import os
import urllib.request
from typing import overload

import numpy as np
import numpy.typing as npt

from pce.substrate.embed import Embedder as LexicalEmbedder

_REFERENCE = [
    "The market was crowded and loud.", "She walked home slowly in the evening.", "A river runs through the old town.",
    "The festival begins at dawn.", "He repaired the broken clock.", "Children played in the courtyard.",
    "ಬೆಳಗಿನ ಗಾಳಿಯಲ್ಲಿ ಹೂವಿನ ಪರಿಮಳ", "ಅವನು ಊರಿಗೆ ಹೋದನು", "ಹಳ್ಳಿಯ ಜಾತ್ರೆ ಸಂಜೆ ಶುರುವಾಯಿತು",
    "காலையில் கோவில் மணி ஒலித்தது", "அவள் ஆற்றங்கரையில் நடந்தாள்", "ఉదయం మార్కెట్ రద్దీగా ఉంది",
    "बारिश के बाद सड़क गीली थी", "वह शाम को घर लौटा", "त्योहार की तैयारी चल रही है",
    "সন্ধ্যায় নদীর ধারে হাওয়া বইছে", "മഴ പെയ്തു കഴിഞ്ഞ് മുറ്റം നനഞ്ഞു",
    "Numbers and tables were added to the report.", "The engine needs oil and a new filter.",
    "A song about courage and a long road.", "Quiet streets before the first train.",
    "Two friends argued about a cricket match.", "The recipe calls for ginger and cumin.", "Old letters in a wooden box.",
]


class Embedder(LexicalEmbedder):
    def __init__(self, url: str | None = None, token: str | None = None) -> None:
        super().__init__(model_id="multilingual-embedding@service")
        self.url = (url or os.environ["EMBED_URL"]).rstrip("/")
        self.token = token or os.environ["EMBED_TOKEN"]
        self._cache: dict[str, npt.NDArray[np.float32]] = {}
        raw = self._fetch(_REFERENCE)
        self._mu = raw.mean(axis=0)
        self.dim = int(raw.shape[1])

    def _fetch(self, texts: list[str]) -> npt.NDArray[np.float32]:
        out: list[list[float]] = []
        for i in range(0, len(texts), 32):
            req = urllib.request.Request(
                self.url + "/embed", method="POST",
                data=json.dumps({"texts": texts[i : i + 32], "kind": "similarity"}).encode(),
                headers={"Authorization": f"Bearer {self.token}", "content-type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310 - fixed https endpoint
                out.extend(json.loads(r.read())["vectors"])
        return np.asarray(out, dtype=np.float32)

    def _centred(self, raw: npt.NDArray[np.float32]) -> npt.NDArray[np.float32]:
        v = raw - self._mu
        return (v / np.clip(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9, None)).astype(np.float32)

    def _vectors(self, items: list[str]) -> npt.NDArray[np.float32]:
        missing = [t for t in dict.fromkeys(items) if t not in self._cache]
        if missing:
            for t, v in zip(missing, self._centred(self._fetch(missing)), strict=True):
                self._cache[t] = v
        return np.stack([self._cache[t] for t in items])

    @overload
    def encode(self, text: str) -> npt.NDArray[np.float32]: ...
    @overload
    def encode(self, text: list[str]) -> npt.NDArray[np.float32]: ...

    def encode(self, text: str | list[str]) -> npt.NDArray[np.float32]:
        if isinstance(text, str):
            return self._vectors([text])[0]
        items = list(text)
        if not items or any(not isinstance(t, str) for t in items):
            raise ValueError("Embedder.encode requires a string or list[str]")
        return self._vectors(items)
