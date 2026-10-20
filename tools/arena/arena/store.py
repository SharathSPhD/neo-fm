"""File layout under ARENA_HOME (default tools/arena/data); everything is plain JSON/JSONL so threads can PR entries.

  briefs/lyrics.json, briefs/songs.json   list of {id, lang, language, style, brief, tier}
  variants.json                           {variant: {kind, label, owner, reference?}}
  entries/lyrics/<variant>.json           {brief_id: lyric text}
  entries/songs/<variant>.json            {brief_id: {audio, scores{}, usd}}
  battles.jsonl                           one judged pair per line (append-only)
  costs.jsonl                             one generation cost per line (append-only)
"""
from __future__ import annotations

import json
import os
from pathlib import Path

HOME = Path(os.environ.get("ARENA_HOME", Path(__file__).resolve().parent.parent / "data"))


def read_json(rel: str, default=None):
    p = HOME / rel
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def write_json(rel: str, obj) -> None:
    p = HOME / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def read_jsonl(rel: str) -> list[dict]:
    p = HOME / rel
    if not p.exists():
        return []
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]


def append_jsonl(rel: str, rows: list[dict]) -> None:
    p = HOME / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def briefs(kind: str) -> dict[str, dict]:
    return {b["id"]: b for b in read_json(f"briefs/{kind}.json", [])}


def variants() -> dict[str, dict]:
    return read_json("variants.json", {})


def entries(kind: str, variant: str) -> dict:
    return read_json(f"entries/{kind}/{variant}.json", {})
