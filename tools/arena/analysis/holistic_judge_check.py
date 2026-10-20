"""Does the Gemini holistic audio listen track sung-word diction? Uses stored lab data only (no spend).
Usage: python3 analysis/holistic_judge_check.py <repo-root>"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from arena import validate

root = sys.argv[1]
bj = json.load(open(f"{root}/managed-agents/quality/blind-judge-60s.json"))
m = {r["id"]: r for r in map(json.loads, open(f"{root}/managed-agents/quality/full-60s.jsonl"))}
rows = [(m[b["file"][:-4]]["matchPct"], b) for b in bj if "overall" in b and b["file"][:-4] in m]
diction = [d for d, _ in rows]
print(f"pointwise, {len(rows)} full 60s renders (diction match vs Gemini blind listen)")
for k in ("overall", "pronunciation", "stress_rhythm", "clarity"):
    v = [b[k] for _, b in rows]
    lo, hi = validate.spearman_ci(diction, v)
    print(f"  {k:14s} rho={validate.spearman(diction, v):+.2f} (95% {lo:+.2f}..{hi:+.2f}) distinct values={sorted(set(v))}")
low = [(d, b["pronunciation"]) for d, b in rows if d < 85]
print("  renders under 85% diction and their 'pronunciation' score:", low)
# E2 slice 1b: same input rendered twice, holistic judge both orders (render-harness/plan.md)
pairs = [{"name": n, "a_ref": a, "b_ref": b, "pick": "b"} for n, a, b in
         (("duet", 98, 93), ("qawwali", 100, 85), ("bhajan", 100, 76))]
# 'a' is the higher-diction render in each pair as recorded; the judge chose the other in both orders
print("pairwise:", validate.pairwise_agreement(pairs, gap=5))
