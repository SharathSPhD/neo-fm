"""Cost per song/lyric per variant. Sources: costs.jsonl (variant, brief, usd, note) and entries'
own `usd`. Estimates beat meters here: the lab's route meter undercounts."""
from __future__ import annotations

from . import store


def per_variant() -> dict[str, dict]:
    tot: dict[str, list[float]] = {}
    for r in store.read_jsonl("costs.jsonl"):
        tot.setdefault(r["variant"], []).append(float(r["usd"]))
    for kind in ("lyrics", "songs"):
        for v, meta in store.variants().items():
            if meta["kind"] != kind or v in tot:
                continue
            xs = [e["usd"] for e in store.entries(kind, v).values() if isinstance(e, dict) and "usd" in e]
            if xs:
                tot[v] = xs
    return {v: {"mean_usd": sum(xs) / len(xs), "n": len(xs)} for v, xs in tot.items()}
