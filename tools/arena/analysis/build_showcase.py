"""Build apps/web/lib/lab/showcase-data.json from judged lab outputs (no model calls, no spend).

Standard = live Sonnet polish; Premium = Opus 5.5 polish with corpus refs (lab arm refs_opus). Both come from the same
plain Haiku draft per brief, judged blind in both orders by Claude and Gemini (strategy/premium-lyrics-tier.md section 9).
Usage: python3 build_showcase.py [LAB_DIR] [OUT]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

LAB = Path(sys.argv[1] if len(sys.argv) > 1 else "/mnt/project-files/lyrics-lab/harness-corpus2")
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).resolve().parents[3] / "apps/web/lib/lab/showcase-data.json")
WINNER = {"pce": "premium", "single": "standard", "tie": "tie"}


def load(name: str):
    return json.loads((LAB / name).read_text(encoding="utf-8"))


def main() -> None:
    briefs = {b["id"]: b for f in ("briefs12.json", "briefs-new12.json") for b in load(f)}
    live, prem, judge = load("arm_live23.json"), load("arm_refs_opus23.json"), load("judge_refsopus_vs_live23.json")
    cases = []
    for cid in load("inputs23.json"):
        b = briefs[cid]
        row = {"id": cid, "lang": b["code"], "style": b["style"], "brief": b["text"],
               "standard": live[cid]["lyrics"].strip(), "premium": prem[cid]["lyrics"].strip(), "judges": {}}
        for fam in ("claude", "gemini"):
            j = judge[cid][fam]
            d = j["detail"]
            # One Claude verdict (hi-f8) was unparseable; the lab counts it as a tie, so keep the count but flag it.
            row["judges"][fam] = {"winner": WINNER[j["winner"]], "diff": d.get("total_diff"), "dims": d.get("dim_diff"), "unparsed": "error" in d}
        cases.append(row)
    cases.sort(key=lambda c: (c["lang"], int(c["id"].split("-f")[1])))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"source": "lyrics-lab/harness-corpus2 refs_opus vs live, 2026-10-21", "cases": cases}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(len(cases), "cases ->", OUT)


main()
