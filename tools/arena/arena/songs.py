"""Song battles. Songs are judged by scorers, not one LLM: each scorer gives every rendered song a
number, scores are min-max scaled per scorer (ranges in data/song-weights.json), blended with
weights, and two songs for the same brief become a battle from the blended difference.

Scorers (S's split, 2026-10-20): `gemini_audio` (Gemini audio judge), and the local scorers
`sung_word_acc`, `audio_quality`, `text_audio_match`, `music_arena_pref`. Direct Gemini pairwise
verdicts can also be loaded with `ingest_pairwise`. A song missing a scorer is blended over the
scorers it has; if a pair shares none the battle is skipped.
"""
from __future__ import annotations

from . import store

# Weights follow the audio-scoring lab (2026-10-20): Music Arena preference model 61.5% held-out
# (weak, vocals 59%), audio quality (PQ) flat at 7.9-8.2, CLAP text match about 0 on native-script
# text (score it against English style descriptions), sung-word accuracy needs no reference text.
# Malayalam is unmeasured. So the Gemini audio judge and sung-word accuracy carry the blend.
DEFAULT_WEIGHTS = {
    "gemini_audio": {"w": 0.45, "lo": 1, "hi": 5},
    "sung_word_acc": {"w": 0.35, "lo": 0, "hi": 1},
    "music_arena_pref": {"w": 0.10, "lo": 0, "hi": 1},
    "audio_quality": {"w": 0.05, "lo": 0, "hi": 10},
    "text_audio_match": {"w": 0.05, "lo": 0, "hi": 1},
}
MARGIN = 0.04  # blended-score gap under which a pair is a tie; about one scorer-step of noise


def weights() -> dict:
    return store.read_json("song-weights.json", DEFAULT_WEIGHTS)


def blend(scores: dict, cfg: dict, only: set[str] | None = None) -> float | None:
    num = den = 0.0
    for k, c in cfg.items():
        if k not in scores or (only is not None and k not in only):
            continue
        x = (min(max(scores[k], c["lo"]), c["hi"]) - c["lo"]) / (c["hi"] - c["lo"])
        num += c["w"] * x
        den += c["w"]
    return num / den if den else None


def battles(a: str, b: str, ts: str, margin: float = MARGIN, redo: bool = False) -> list[dict]:
    cfg = weights()
    A, B = store.entries("songs", a), store.entries("songs", b)
    done = set() if redo else {(r["a"], r["b"], r["brief"]) for r in store.read_jsonl("battles.jsonl") if r["kind"] == "songs"}
    rows = []
    for bid in sorted(set(A) & set(B)):
        if (a, b, bid) in done:
            continue
        sa, sb = A[bid].get("scores", {}), B[bid].get("scores", {})
        shared = set(sa) & set(sb) & set(cfg)  # compare on scorers both songs have
        x, y = blend(sa, cfg, shared), blend(sb, cfg, shared)
        if x is None or y is None:
            continue
        d = x - y
        rows.append({"kind": "songs", "a": a, "b": b, "brief": bid,
                     "score": 1.0 if d > margin else 0.0 if d < -margin else 0.5,
                     "tot": round(d, 3), "scorers": sorted(shared), "judge": "blend/" + ",".join(sorted(shared)), "ts": ts})
    return rows


def ingest_pairwise(verdicts: list[dict], judge: str, ts: str) -> list[dict]:
    """verdicts: [{a, b, brief, winner: "A"|"B"|"tie"}] already de-biased (both orders merged) by the caller."""
    return [{"kind": "songs", "a": v["a"], "b": v["b"], "brief": v["brief"],
             "score": {"A": 1.0, "B": 0.0, "tie": 0.5}[v["winner"]], "judge": judge, "ts": ts} for v in verdicts]
