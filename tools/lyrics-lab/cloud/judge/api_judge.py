#!/usr/bin/env python3
"""Run the blind pairwise judge items through the live /api/admin/lyrics-teacher route (CMA key, metered, capped).
python cloud/judge/api_judge.py <part 0|1> <out.json>   (parts of 120 items; ADMIN bearer from env MA_PROD_ADMIN_SECRET)"""
import json, os, sys, glob, urllib.request
part, outp = int(sys.argv[1]), sys.argv[2]
items = [i for f in sorted(glob.glob(os.path.join(os.path.dirname(__file__), "in", "judge_*.json"))) for i in json.load(open(f))]
items = items[part * 120:(part + 1) * 120]
RUB = open(os.path.join(os.path.dirname(__file__), "..", "JUDGE.md"), encoding="utf-8").read().split("## What to do for each item")[1].split("## Output")[0].strip()
SYSTEM = ("You are a senior lyricist and native-level editor in the given Indian language. Two song lyrics were written for the same brief. "
          + RUB + "\nReply with ONLY JSON: {\"reason\":\"<=40 words\",\"A\":{six scores},\"B\":{six scores},\"winner\":\"A|B|tie\"}")
jobs = [{"id": i["item"], "n": 1, "prompt": f"Language: {i['language']}\nStyle: {i['style']}\nBrief: {i['brief']}\n\n=== LYRIC A ===\n{i['A']}\n\n=== LYRIC B ===\n{i['B']}"} for i in items]
body = json.dumps({"model": "claude-sonnet-5-5", "system": SYSTEM, "max_tokens": 450, "max_usd": 2.0, "jobs": jobs}).encode()
r = urllib.request.Request("https://www.neo-fm.com/api/admin/lyrics-teacher", body, {"authorization": "Bearer " + os.environ["MA_PROD_ADMIN_SECRET"], "content-type": "application/json"})
o = json.load(urllib.request.urlopen(r, timeout=290))
json.dump(o, open(outp, "w"), ensure_ascii=False)
print({k: v for k, v in o.items() if k != "results"})
