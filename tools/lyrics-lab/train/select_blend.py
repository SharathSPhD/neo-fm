#!/usr/bin/env python3
"""Round-2 target selection: metric AND Claude judge, not the metric alone (see 05-experiments.md addendum: det-selected targets
raised det but lost the blind judge). Two stages.
  prep : python train/select_blend.py prep --cands all.json --ngrams ngram4.txt --per-lang 50 --out cloud/judge3
         top-3 valid candidates per brief by reward (det, repetition-penalised, overlap-gated) -> listwise judge jobs (1 call per brief)
         files: <out>/jobs_k.json (60 jobs per file, route format), <out>/key.json (job id -> brief + candidates)
  blend: python train/select_blend.py blend --key <out>/key.json --judged part0.json part1.json ... --out sft_r2.jsonl --pairs-out pairs_r2.jsonl
         final = judge_mean (1-5, from rubric dims) * 20 + 0.5 * reward ; chosen = best, rejected = worst when judge gap >= 0.8"""
import argparse, json, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bench")); sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "corpus"))
import lyricmetrics as lm, overlap
DIMS = ["meter_singability", "rhyme_prasa", "imagery", "diction_register", "cultural_fit", "brief_fidelity"]
SYS = ("You are a senior lyricist and native-level editor in the given Indian language. Score each numbered lyric for the same brief 1-5 (integers; 3 competent, 5 outstanding) on: "
       + ", ".join(DIMS) + ". Invented or ungrammatical words lose points on diction_register; judge quality, not length. "
       'Reply with ONLY JSON, no prose before it: {"1":{"meter_singability":n,...},"2":{...},"3":{...}}')
def reward(s): return s["det"] - 40 * max(0.0, 0.6 - s["uniq_lines"])
ap = argparse.ArgumentParser(); ap.add_argument("mode", choices=["prep", "blend"])
ap.add_argument("--cands"); ap.add_argument("--ngrams"); ap.add_argument("--per-lang", type=int, default=50); ap.add_argument("--out")
ap.add_argument("--key"); ap.add_argument("--judged", nargs="*"); ap.add_argument("--pairs-out"); ap.add_argument("--min-gap", type=float, default=0.8)
a = ap.parse_args()
if a.mode == "prep":
    corpus = overlap.load(a.ngrams); data = json.load(open(a.cands)); os.makedirs(a.out, exist_ok=True); key = {}; n = {}
    for bid, v in data.items():
        b = v["brief"]
        if n.get(b["lang"], 0) >= a.per_lang: continue
        sc = []
        for t in v["cands"]:
            s = lm.score(t, b["lang"])
            if s.get("valid") and s["script"] >= 0.99 and overlap.ratio(t, corpus) <= overlap.MAX_RATIO: sc.append((reward(s), t))
        sc.sort(key=lambda x: -x[0]); top = sc[:3]
        if len(top) < 3: continue
        n[b["lang"]] = n.get(b["lang"], 0) + 1
        key[bid] = {"brief": b, "cands": [t for _, t in top], "reward": [round(r, 1) for r, _ in top]}
    ids = list(key)
    for k in range(0, len(ids), 60):
        jobs = [{"id": i, "n": 1, "prompt": f"Language: {key[i]['brief']['language']}\nStyle: {key[i]['brief']['style']}\nBrief: {key[i]['brief']['brief']}\n\n"
                 + "\n\n".join(f"=== LYRIC {j+1} ===\n{t}" for j, t in enumerate(key[i]["cands"]))} for i in ids[k:k + 60]]
        json.dump({"model": "claude-sonnet-5-5", "system": SYS, "max_tokens": 800, "max_usd": 1.5, "jobs": jobs}, open(f"{a.out}/jobs_{k//60}.json", "w"), ensure_ascii=False)
    json.dump(key, open(f"{a.out}/key.json", "w"), ensure_ascii=False); print("briefs", len(ids), "files", (len(ids) + 59) // 60, n)
else:
    key = json.load(open(a.key)); nsft = npairs = 0
    fs = open(a.out, "w", encoding="utf-8"); fp = open(a.pairs_out, "w", encoding="utf-8")
    for f in a.judged:
        for jid, outs in json.load(open(f))["results"].items():
            if jid not in key or not outs: continue
            try:
                t = outs[0]; j = json.loads(t[t.index("{"):t.rindex("}") + 1]); k = key[jid]
                jm = [sum(j[str(i + 1)][d] for d in DIMS) / len(DIMS) for i in range(3)]
            except Exception: continue
            fin = [m * 20 + 0.5 * r for m, r in zip(jm, k["reward"])]
            order = sorted(range(3), key=lambda i: -fin[i]); b = k["brief"]
            fs.write(json.dumps({"id": jid, "lang": b["lang"], "style": b["style"], "brief": b["brief"], "text": k["cands"][order[0]], "judge": round(jm[order[0]], 2), "reward": k["reward"][order[0]]}, ensure_ascii=False) + "\n"); nsft += 1
            if jm[order[0]] - jm[order[-1]] >= a.min_gap:
                fp.write(json.dumps({"id": jid, "lang": b["lang"], "style": b["style"], "brief": b["brief"], "chosen": k["cands"][order[0]], "rejected": k["cands"][order[-1]], "margin": round(jm[order[0]] - jm[order[-1]], 2)}, ensure_ascii=False) + "\n"); npairs += 1
    print("sft", nsft, "pairs", npairs)
