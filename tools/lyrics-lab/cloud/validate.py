#!/usr/bin/env python3
"""Check cloud-session teacher outputs: every brief id present with 4 candidates, valid, native script.
python cloud/validate.py cloud/out"""
import json, os, sys, glob
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bench"))
import lyricmetrics as lm
d = sys.argv[1] if len(sys.argv) > 1 else "cloud/out"
bad = tot = 0
for bf in sorted(glob.glob(os.path.join(os.path.dirname(__file__), "briefs", "briefs_*.json"))):
    name = os.path.basename(bf).replace("briefs_", "out_"); briefs = json.load(open(bf))
    of = os.path.join(d, name)
    if not os.path.exists(of): print("MISSING", name); bad += len(briefs) * 4; continue
    out = json.load(open(of))
    for b in briefs:
        c = out.get(b["id"], [])
        if len(c) != 4: print("short", b["id"], len(c)); bad += 4 - len(c)
        for t in c:
            tot += 1; s = lm.score(t, b["lang"])
            if not s.get("valid") or s["script"] < 0.99: print("invalid", b["id"], s.get("script")); bad += 1
print("candidates", tot, "problems", bad)
