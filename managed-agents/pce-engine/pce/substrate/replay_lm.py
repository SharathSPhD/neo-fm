"""ReplayLM: lets the unmodified `run_cascade` run when the *agent* is the language model.

Generation happens outside this process (the agent / worker subagents write candidate texts to a JSON
file). The cascade asks for K draft candidates, then K revision candidates; whichever pass lacks
texts raises `NeedGeneration`, which the driver turns into a request for the agent.
"""
from __future__ import annotations

import numpy as np

from pce.types import Candidate


class NeedGeneration(Exception):
    def __init__(self, kind: str, have: int, prompt: str, seed: int) -> None:
        super().__init__(f"need {kind} candidates (have {have})")
        self.kind, self.have, self.prompt, self.seed = kind, have, prompt, seed


class ReplayLM:
    name = "agent-replay"
    supports_logprobs = False
    supports_score = False
    supports_entropy = False

    def __init__(self, draft: list[str], revision: list[str], embed: object) -> None:
        self._embed = embed
        self._texts = {"draft": list(draft), "revision": list(revision)}
        self._used = {"draft": 0, "revision": 0}

    def generate(self, prompt: str, *, max_tokens: int, sampler: dict[str, float], seed: int) -> Candidate:
        kind = "revision" if "Reviser brief:" in prompt else "draft"
        i = self._used[kind]
        if i >= len(self._texts[kind]):
            raise NeedGeneration(kind, len(self._texts[kind]), prompt, seed)
        self._used[kind] = i + 1
        text = self._texts[kind][i]
        n = len(text.split())
        return Candidate(seed=seed, sampler=dict(sampler), tokens=tuple(range(n)), text=text,
                         logp=-float(n), embedding=np.asarray(self._embed.encode(text), dtype=np.float32))

    def length_proxy_logp(self, candidate: Candidate) -> float:
        return -float(len(candidate.tokens))

    def report(self) -> dict[str, object]:
        return {"name": self.name, "model": "agent"}


class RecorderLM:
    """Records the exact (prompt, seed) of every request so the driver can hand the agent all of them at once."""

    name = "recorder"
    supports_logprobs = False
    supports_score = False
    supports_entropy = False

    def __init__(self) -> None:
        self.requests: list[tuple[str, int]] = []

    def generate(self, prompt: str, *, max_tokens: int, sampler: dict[str, float], seed: int) -> Candidate:
        self.requests.append((prompt, seed))
        return Candidate(seed=seed, sampler=dict(sampler), tokens=(0,), text="x", logp=-1.0,
                         embedding=np.zeros(1, dtype=np.float32))

    def length_proxy_logp(self, candidate: Candidate) -> float:
        return -1.0

    def report(self) -> dict[str, object]:
        return {"name": self.name}
