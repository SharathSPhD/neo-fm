#!/usr/bin/env python3
"""Teacher candidates: N samples per training brief from gemini-3.5-flash with thinking OFF (thinking tokens multiplied cost 10x in the first lab run).
Resumable; stops at a hard token cap so spend cannot run away. Output feeds mine_pairs.py (pairs) and the SFT teacher set (best candidate).
python train/teacher_gen.py --per-lang 100 --n 6 --out data/teacher_cands.json --max-out-tokens 900000"""
import argparse, json, os, sys, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(__file__)); sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bench"))
import common, gem
ap = argparse.ArgumentParser()
ap.add_argument("--per-lang", type=int, default=100); ap.add_argument("--n", type=int, default=6); ap.add_argument("--out", required=True)
ap.add_argument("--max-out-tokens", type=int, default=900000); ap.add_argument("--model", default="gemini-3.5-flash")
a = ap.parse_args()
bench = json.load(open(os.path.join(os.path.dirname(__file__), "..", "bench", "briefs.json")))
briefs = common.train_briefs(a.per_lang, exclude={b["brief"] for b in bench})
done = json.load(open(a.out)) if os.path.exists(a.out) else {}
def clean(t): return t.strip().removeprefix("```").removesuffix("```").strip()
def one(b):
    if sum(v[1] for v in gem.USAGE.values()) > a.max_out_tokens: return b["id"], None
    p = common.song_prompt(b["lang"], b["style"], b["brief"])
    try: c = [clean(gem.call(a.model, p, thinking=0, max_tokens=700)) for _ in range(a.n)]
    except Exception as e: return b["id"], None
    return b["id"], {"brief": b, "cands": c}
todo = [b for b in briefs if b["id"] not in done]
with cf.ThreadPoolExecutor(8) as ex:
    for i, (bid, v) in enumerate(ex.map(one, todo)):
        if v: done[bid] = v
        if i % 25 == 0: json.dump(done, open(a.out, "w"), ensure_ascii=False); print(i, len(done), gem.USAGE, flush=True)
json.dump(done, open(a.out, "w"), ensure_ascii=False); print("done", len(done), gem.USAGE)
