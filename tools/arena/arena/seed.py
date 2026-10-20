"""Import the lyrics lab's already-paid judgments so the arena starts with real battles (no new spend).

Source: the lab's shared folder (lyrics-lab/bench). G0 = live-style one-shot, G1 = plan-then-write,
G2 = best-of-6 reranked by the deterministic scorer, G3 = G1 + checker repair. Gemini cmp files were
judged in both orders; the Claude G2-vs-G0 round was single order, so it carries its own judge tag.
"""
from __future__ import annotations

import json
from pathlib import Path

from . import store

VARIANTS = {
    "lab-g0-oneshot": ("G0 one-shot (live-style)", True),
    "lab-g1-plan": ("G1 plan then write", False),
    "lab-g2-bo6-rerank": ("G2 best-of-6 + det rerank", False),
    "lab-g3-repair": ("G3 plan + checker repair", False),
}
ARM = {"G0": "lab-g0-oneshot", "G1": "lab-g1-plan", "G2": "lab-g2-bo6-rerank", "G3": "lab-g3-repair"}


def import_lab(src: str, ts: str) -> dict:
    src_p = Path(src)
    vs = store.variants()
    for k, (label, ref) in VARIANTS.items():
        vs[k] = {"kind": "lyrics", "label": label, "owner": "lyrics-lab", **({"reference": True} if ref else {})}
    store.write_json("variants.json", vs)
    for arm, name in ARM.items():
        store.write_json(f"entries/lyrics/{name}.json", json.loads((src_p / "bench/arms" / f"{arm}.json").read_text(encoding="utf-8")))
    added = 0
    rows = []
    for x, y in (("G1", "G0"), ("G2", "G0"), ("G3", "G0"), ("G3", "G1")):
        cmp = json.loads((src_p / f"bench/arms/cmp_{x}_vs_{y}.json").read_text(encoding="utf-8"))
        for bid, r in cmp.items():
            rows.append({"kind": "lyrics", "a": ARM[x], "b": ARM[y], "brief": bid, "score": float(r["x_win"]),
                         "tot": r["tot"], "diff": r["diff"], "judge": "gemini-3.1-pro-preview/lab-v1", "ts": ts})
    key = json.loads((src_p / "bench/claude_pairs_G2_G0.key.json").read_text(encoding="utf-8"))
    for j in json.loads((src_p / "bench/claude_judgments_G2_G0.json").read_text(encoding="utf-8")):
        slot = key.get(j["id"])  # slot (A/B) holding G2
        if slot not in ("A", "B"):
            continue
        s = 0.5 if j["winner"] == "tie" else 1.0 if j["winner"] == slot else 0.0
        rows.append({"kind": "lyrics", "a": ARM["G2"], "b": ARM["G0"], "brief": j["id"], "score": s,
                     "judge": "claude-lab/single-order", "ts": ts})
    existing = {(r["a"], r["b"], r["brief"], r["judge"]) for r in store.read_jsonl("battles.jsonl")}
    fresh = [r for r in rows if (r["a"], r["b"], r["brief"], r["judge"]) not in existing]
    store.append_jsonl("battles.jsonl", fresh)
    return {"battles_added": len(fresh), "variants": len(VARIANTS)}
