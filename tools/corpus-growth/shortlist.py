#!/usr/bin/env python3
"""Free pre-filter before any paid judging: rank gated verse units by cheap structure signals and keep a per-author-balanced shortlist.
Signals: 6-24 lines, steady line length (low variation), repeated line-final sounds (rhyme proxy), target-script share, no digits/latin noise.
Usage: shortlist.py IN.jsonl OUT.jsonl [--n 300] [--per-author 40]"""
import json, re, sys, collections
a = sys.argv; n = int(a[a.index("--n") + 1]) if "--n" in a else 300; cap = int(a[a.index("--per-author") + 1]) if "--per-author" in a else 40
def score(r):
    ls = [l for l in r["text"].split("\n") if l.strip()]
    if not 6 <= len(ls) <= 24: return None
    lens = [len(l) for l in ls]; m = sum(lens) / len(lens); sd = (sum((x - m) ** 2 for x in lens) / len(lens)) ** 0.5
    ends = collections.Counter(l.strip(" ।॥.,;!?'\"")[-2:] for l in ls); rhyme = sum(c for c in ends.values() if c > 1) / len(ls)
    letters = [c for c in r["text"] if c.isalpha()]; latin = sum(c.isascii() for c in letters) / max(1, len(letters))
    if (r["lang"] != "en" and latin > 0.1) or re.search(r"\d{3}", r["text"]): return None
    return round(rhyme * 2 - sd / max(m, 1) + (1 if 20 <= m <= 45 else 0), 3)
rows = [(score(r), r) for r in map(json.loads, open(a[1], encoding="utf-8"))]
rows = sorted([x for x in rows if x[0] is not None], key=lambda x: -x[0]); per = collections.Counter(); out = []
for s, r in rows:
    k = r.get("author") or r.get("book")
    if per[k] >= cap: continue
    per[k] += 1; r["pre_score"] = s; out.append(r)
    if len(out) >= n: break
open(a[2], "w", encoding="utf-8").write("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out))
print(a[1], "->", len(out), dict(per.most_common(8)))
