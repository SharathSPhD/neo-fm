#!/usr/bin/env python3
"""Free analysis of the Kannada reference pool (no API calls).
1) Replays the harness's deterministic exemplar retrieval (exemplars.ts, k=3) for the kn briefs of the refs-vs-live judging and
   tabulates, per exemplar, how often it was retrieved and the judged margin of the briefs it served (Claude + Gemini total_diff).
2) Scores the kn exemplars and the PD verse shortlist with the deterministic lyric metrics (bench/lyricmetrics.score).
usage: kn_refs_analysis.py <harness-corpus2 dir> <shortlist kn.jsonl> out.json"""
import json, re, sys, os, statistics as st, collections
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bench"))
import lyricmetrics as lm

root = os.path.join(os.path.dirname(__file__), "..", "..", "..")
EX = [e for e in json.load(open(os.path.join(root, "apps/web/lib/lyrics/harness/data/exemplars.json"))) if e["lang"] == "kn"]
toks = lambda s: set(re.findall(r"[a-z]{3,}", s.lower()))

def retrieve(style, brief, k=3):
    bt = toks(brief); fam = style.split("-")[0]; out = []
    for e in EX:
        et = toks(e["brief"]); jac = len(et & bt) / max(1, len(et | bt))
        out.append((( 1 if e["style"] == style else 0.5 if fam and e["style"].startswith(fam) else 0) + 2 * jac + 0.25 * (e["judge"] - 3), e))
    out.sort(key=lambda x: (-x[0], x[1]["id"])); return [e for _, e in out[:k]]

d, sl, outp = sys.argv[1:4]
inputs = {}
for f in ("inputs12.json", "inputs-new.json", "inputs23.json"):
    inputs.update(json.load(open(os.path.join(d, f))))
judge = json.load(open(os.path.join(d, "judge_refsopus_vs_live23.json")))
per = collections.defaultdict(list); briefs = []
for bid, j in judge.items():
    if not bid.startswith("kn") or bid not in inputs: continue
    m = [j["claude"]["detail"]["total_diff"], j["gemini"]["detail"]["total_diff"]]
    ex = retrieve(inputs[bid]["style"], inputs[bid]["brief"]); briefs.append({"id": bid, "margin": st.mean(m), "ex": [e["id"] for e in ex]})
    for e in ex: per[e["id"]].append(st.mean(m))
table = sorted(({"id": i, "n": len(v), "mean_margin": round(st.mean(v), 2)} for i, v in per.items()), key=lambda r: -r["mean_margin"])
unused = [e["id"] for e in EX if e["id"] not in per]
sc = lambda t: lm.score(t, "kn")
def comp(rows): 
    s = [sc(t)["det"] if isinstance(sc(t), dict) and "det" in sc(t) else None for t in rows]; return s
ex_s = [sc(e["text"]) for e in EX]
sl_rows = [json.loads(l) for l in open(sl, encoding="utf-8")]
sl_s = [(r["id"], r.get("author"), r.get("tier"), sc(r["text"])) for r in sl_rows]
det = lambda x: x["det"]
by_author = collections.defaultdict(list)
for _, a, t, x in sl_s: by_author[a].append(det(x))
corr_rows = [(det(sc(e["text"])), st.mean(per[e["id"]])) for e in EX if e["id"] in per and len(per[e["id"]]) >= 3]
def pearson(a, b):
    ma, mb = st.mean(a), st.mean(b); den = (sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b)) ** .5
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / den if den else float("nan")
summary = {"exemplar_det_mean": round(st.mean(det(x) for x in ex_s), 1), "shortlist_det_mean": round(st.mean(det(x[3]) for x in sl_s), 1),
           "shortlist_by_author": {a: [len(v), round(st.mean(v), 1)] for a, v in sorted(by_author.items(), key=lambda kv: -len(kv[1]))},
           "shortlist_tier": dict(collections.Counter(t for _, _, t, _ in sl_s)),
           "det_vs_margin_pearson_n3plus": [len(corr_rows), round(pearson(*zip(*corr_rows)), 2) if len(corr_rows) > 2 else None]}
res = {"summary": summary, "n_briefs": len(briefs), "briefs": briefs, "per_exemplar": table, "exemplars_never_retrieved": unused, "n_exemplars": len(EX),
       "shortlist_n": len(sl_s)}
json.dump(res, open(outp, "w"), ensure_ascii=False, indent=1)
print("kn briefs", len(briefs), "exemplars", len(EX), "retrieved at least once", len(per), "never", len(unused))
print(json.dumps(summary, ensure_ascii=False, indent=1)); print("top", table[:5]); print("bottom", table[-5:]); print("metric sample", ex_s[0])
