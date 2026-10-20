#!/usr/bin/env python3
"""Build the judge-picked exemplar index the lyrics harness retrieves from (zero API spend).

Source: data/mined/sft_r2.jsonl (the best of 3 candidates per brief by Claude listwise judge x metric, see 05-experiments.md) and the
chosen side of data/mined/pairs_r2.jsonl. Kept only when judge mean >= --min-judge, and dropped when the brief is a near-duplicate of a
LyricBench-5 eval brief (the harness is evaluated on those, so they must never appear as exemplars).
  python tools/lyrics-lab/harness/build_exemplars.py --mined <lyrics-lab/data/mined> --bench <lyrics-lab/bench/briefs.json> \
      --out apps/web/lib/lyrics/harness/data/exemplars.json
"""
import argparse, json, re

def toks(s): return set(re.findall(r"[a-z]{3,}", s.lower()))

ap = argparse.ArgumentParser()
ap.add_argument("--mined", required=True); ap.add_argument("--bench", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--min-judge", type=float, default=3.5); ap.add_argument("--max-jaccard", type=float, default=0.5)
a = ap.parse_args()
bench = [toks(b["brief"]) for b in json.load(open(a.bench))]
out, dropped = [], {"low_judge": 0, "eval_overlap": 0}
for l in open(f"{a.mined}/sft_r2.jsonl", encoding="utf-8"):
    r = json.loads(l)
    if r["judge"] < a.min_judge: dropped["low_judge"] += 1; continue
    t = toks(r["brief"])
    if any(len(t & b) / max(1, len(t | b)) >= a.max_jaccard for b in bench): dropped["eval_overlap"] += 1; continue
    out.append({"id": r["id"], "lang": r["lang"], "style": r["style"], "brief": r["brief"], "text": r["text"].strip(), "judge": r["judge"]})
json.dump(out, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
by = {}
for r in out: by[r["lang"]] = by.get(r["lang"], 0) + 1
print("kept", len(out), by, "dropped", dropped)
