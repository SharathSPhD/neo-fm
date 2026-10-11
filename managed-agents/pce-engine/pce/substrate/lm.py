"""Cloud port: the local Qwen substrate is not shipped. `LocalLM` stays importable as a type only."""
from __future__ import annotations


class LocalLM:  # pragma: no cover - placeholder so `cascade` keeps its original signature
    def __init__(self, *_: object, **__: object) -> None:
        raise RuntimeError("LocalLM is not available in the cloud port; use ReplayLM")
