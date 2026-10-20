#!/usr/bin/env python3
"""Turn candidate sets into DPO pairs: reward = deterministic metre/rhyme score (lyricmetrics) gated by an overlap check,
optionally blended with a cheap AI judge (--judge gemini: gemini-3.5-flash-lite absolute 1-5 diction/imagery; logs calls for lab/spend.md).
Pairs need a margin (default 8 points) so noise does not become signal. The judge term matters: constraint-only rewards
raised det but LOST on judge diction in LyricBench (05-experiments.md), so never train on det alone.
python train/mine_pairs.py --cands data/cands.json --ngrams data/out/ngram4.txt --out data/pairs.jsonl [--judge gemini]"""
import argparse, json, os, sys, re
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bench")); sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "corpus"))
import lyricmetrics as lm, overlap
ap = argparse.ArgumentParser()
ap.add_argument("--cands", required=True); ap.add_argument("--ngrams", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--judge", choices=["none", "gemini"], default="none"); ap.add_argument("--margin", type=float, default=8.0)
a = ap.parse_args()
corpus = overlap.load(a.ngrams); data = json.load(open(a.cands)); n_judge = 0
def judge_score(lang, brief, text):
    global n_judge
    import gem
    n_judge += 1
    t = gem.call("gemini-3.5-flash-lite", f"Language: {lang}\nBrief: {brief}\nLyric:\n{text}\n\nRate 1-5 (integer) the lyric's diction (native idiom, correct script, natural wording) and imagery (fresh, concrete). "
                 'Reply only JSON {"diction":n,"imagery":n}', temp=0.0, json_out=True, max_tokens=300)
    j = json.loads(t[t.index("{"):t.rindex("}") + 1]); return (j["diction"] + j["imagery"]) / 2
pairs = 0
with open(a.out, "w", encoding="utf-8") as f:
    for bid, v in data.items():
        b = v["brief"]; scored = []
        for t in v["cands"]:
            s = lm.score(t, b["lang"])
            if not s.get("valid") or s["script"] < 0.99 or overlap.ratio(t, corpus) > overlap.MAX_RATIO: continue
            r = s["det"]
            if a.judge == "gemini": r += 12 * (judge_score(b["language"], b["brief"], t) - 3)
            scored.append((r, t))
        if len(scored) < 2: continue
        scored.sort(key=lambda x: -x[0])
        if scored[0][0] - scored[-1][0] < a.margin: continue
        prompt = __import__("common").song_prompt(b["lang"], b["style"], b["brief"]) if False else None
        f.write(json.dumps({"id": bid, "lang": b["lang"], "style": b["style"], "brief": b["brief"], "chosen": scored[0][1], "rejected": scored[-1][1],
                            "margin": round(scored[0][0] - scored[-1][0], 1)}, ensure_ascii=False) + "\n"); pairs += 1
print("pairs", pairs, "judge calls", n_judge)
