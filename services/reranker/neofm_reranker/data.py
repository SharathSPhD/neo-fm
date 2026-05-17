"""Preference-pair dataset utilities for the v1.4 reranker.

The training corpus is materialised as a parquet (or JSONL when
parquet libs are unavailable) file with one row per preference pair.
This module is intentionally dependency-light: the dataset class can
load rows from a list of dicts so unit tests run without disk I/O.

Schema (every row):
  - winner_audio_path: str
  - loser_audio_path: str
  - style: str | None
  - language: str | None
  - vote_source: str
  - weight: float (1.0 for compare-page, 0.25 for compare-page-tie)
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class PreferenceRow:
    winner_audio_path: str
    loser_audio_path: str
    style: str | None
    language: str | None
    vote_source: str
    weight: float

    @classmethod
    def from_dict(cls, row: dict[str, object]) -> PreferenceRow:
        vote_source = str(row.get("vote_source", "compare-page"))
        # Tie votes are worth less. The reward model treats them as
        # weak labels rather than dropping them entirely.
        default_weight = 0.25 if vote_source == "compare-page-tie" else 1.0
        weight_raw = row.get("weight", default_weight)
        return cls(
            winner_audio_path=str(row["winner_audio_path"]),
            loser_audio_path=str(row["loser_audio_path"]),
            style=row.get("style") if row.get("style") is None else str(row["style"]),  # type: ignore[arg-type]
            language=row.get("language")
            if row.get("language") is None
            else str(row["language"]),  # type: ignore[arg-type]
            vote_source=vote_source,
            weight=float(weight_raw),  # type: ignore[arg-type]
        )


class PreferencePairsDataset:
    """In-memory dataset that supports deterministic train/val splitting."""

    def __init__(self, rows: Iterable[PreferenceRow]) -> None:
        self._rows: list[PreferenceRow] = list(rows)

    @classmethod
    def from_dicts(cls, rows: Iterable[dict[str, object]]) -> PreferencePairsDataset:
        return cls(PreferenceRow.from_dict(row) for row in rows)

    @classmethod
    def from_jsonl(cls, path: Path) -> PreferencePairsDataset:
        rows: list[PreferenceRow] = []
        with path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                rows.append(PreferenceRow.from_dict(json.loads(line)))
        return cls(rows)

    def __len__(self) -> int:
        return len(self._rows)

    def __iter__(self) -> Iterator[PreferenceRow]:
        return iter(self._rows)

    def __getitem__(self, idx: int) -> PreferenceRow:
        return self._rows[idx]

    def split(
        self,
        val_fraction: float = 0.1,
        *,
        seed: int = 0,
    ) -> tuple[PreferencePairsDataset, PreferencePairsDataset]:
        """Deterministic train/val split.

        The split is purely positional after a hash-based shuffle so
        the same `seed` produces the same partition across runs.
        """
        if not 0.0 <= val_fraction < 1.0:
            raise ValueError(f"val_fraction must be in [0, 1): {val_fraction}")
        n = len(self._rows)
        if n == 0:
            return PreferencePairsDataset([]), PreferencePairsDataset([])
        indices = list(range(n))
        # Stable position-only shuffle: sort by hash(index, seed) for
        # determinism without importing `random`.
        indices.sort(key=lambda i: (hash((i, seed)) & 0xFFFFFFFF, i))
        val_count = int(n * val_fraction)
        val_idx = set(indices[:val_count])
        train_rows = [r for i, r in enumerate(self._rows) if i not in val_idx]
        val_rows = [r for i, r in enumerate(self._rows) if i in val_idx]
        return PreferencePairsDataset(train_rows), PreferencePairsDataset(val_rows)

    def by_style(self) -> dict[str | None, list[PreferenceRow]]:
        out: dict[str | None, list[PreferenceRow]] = {}
        for row in self._rows:
            out.setdefault(row.style, []).append(row)
        return out
