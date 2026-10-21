#!/usr/bin/env python3
"""Write manifest.json (rows, units, characters, tiers, authors per language) for a directory of gated lyric-reference JSONL files.
Usage: manifest.py DIR"""
import json, sys, glob, os, collections
d = sys.argv[1]; out = {}
for f in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
    lang = os.path.basename(f)[:-6]; rows = [json.loads(l) for l in open(f, encoding="utf-8")]
    tiers = collections.Counter(r.get("tier", "A") for r in rows); au = collections.Counter(r.get("author") or r.get("book") for r in rows)
    out[lang] = {"rows": len(rows), "chars": sum(len(r["text"]) for r in rows), "lines": sum(r["n_lines"] for r in rows), "tiers": dict(tiers), "top_authors_or_books": au.most_common(8)}
json.dump(out, open(os.path.join(d, "manifest.json"), "w"), indent=1, ensure_ascii=False); print(json.dumps({k: {"rows": v["rows"], "chars": v["chars"], "tiers": v["tiers"]} for k, v in out.items()}, ensure_ascii=False))
