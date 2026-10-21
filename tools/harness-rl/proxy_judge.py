"""Validate a cheap Haiku pairwise judge against the lab's judge-labelled pairs (tools/lyrics-lab/results/pairs_r2_judge_selected.jsonl).

Each pair is judged in both orders via POST /api/admin/lyrics-teacher (prod key, bounded). Agreement = proxy picks the
lyric the Claude/Gemini panel chose. Spends money: `estimate` is free, `run` needs a hard stop and S's tap.
    python3 proxy_judge.py estimate
    python3 proxy_judge.py run --hard-stop-usd 0.30
"""
from __future__ import annotations
import argparse, json, os, sys, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "arena"))
from arena import lyrics as L  # noqa: E402

PAIRS = Path(__file__).resolve().parents[1] / "lyrics-lab/results/pairs_r2_judge_selected.jsonl"
OUT = Path(__file__).with_name("proxy_judge_result.json")
MODEL = "claude-haiku-5-5"
PRICE_IN, PRICE_OUT = 1.0, 5.0  # assumed Haiku list USD/M; the route meter undercounts so keep the estimate as the number to trust
URL = os.environ.get("NEO_FM_URL", "https://www.neo-fm.com") + "/api/admin/lyrics-teacher"


def jobs(limit: int = 0) -> list[dict]:
    out = []
    lines = PAIRS.read_text().splitlines()
    step = max(1, len(lines) // limit) if limit else 1  # even stride keeps all languages in the subset
    for i, ln in list(enumerate(lines))[::step][: limit or None]:
        p = json.loads(ln)
        br = {"language": p["lang"], "style": p["style"], "brief": p["brief"]}
        out.append({"id": f"{i}|ab", "prompt": L.prompt(br, p["chosen"], p["rejected"])})
        out.append({"id": f"{i}|ba", "prompt": L.prompt(br, p["rejected"], p["chosen"])})
    return out


def estimate(js: list[dict]) -> float:
    tin = sum(len(L.SYSTEM) + len(j["prompt"]) for j in js) / 1.5  # Indic scripts tokenise heavily
    return (tin * PRICE_IN + L.OUT_TOKENS * len(js) * PRICE_OUT) / 1e6


def call(chunk: list[dict], max_usd: float) -> dict:
    req = urllib.request.Request(URL, json.dumps({"model": MODEL, "system": L.SYSTEM, "max_tokens": 600, "max_usd": max_usd, "jobs": chunk}).encode(),
                                 {"authorization": f"Bearer {os.environ['MA_PROD_ADMIN_SECRET']}", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=290) as r:
        return json.load(r)


def score(results: dict[str, list[str]]) -> dict:
    n = agree = tie = 0
    for i in {k.split("|")[0] for k in results}:
        votes = []
        for order, chosen_is in (("ab", "A"), ("ba", "B")):
            txt = (results.get(f"{i}|{order}") or [""])[0]
            v = L.parse_verdict(txt)
            votes.append(None if not v else (1 if v["winner"] == chosen_is else 0 if v["winner"] == "tie" else -1))
        if None in votes:
            continue
        s = sum(votes)
        n += 1
        agree += s > 0
        tie += s == 0
    return {"pairs": n, "agree_with_panel": agree, "ties": tie, "disagree": n - agree - tie,
            "agreement_excl_ties": round(agree / max(1, n - tie), 3)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["estimate", "run"])
    ap.add_argument("--hard-stop-usd", type=float, default=0.30)
    ap.add_argument("--limit", type=int, default=0, help="judge only this many pairs (both orders)")
    a = ap.parse_args()
    js = jobs(a.limit)
    est = estimate(js)
    print(f"{len(js)} calls, list-price estimate USD {est:.3f}")
    if a.cmd == "estimate":
        return
    if est > a.hard_stop_usd:
        sys.exit(f"estimate {est:.3f} exceeds hard stop {a.hard_stop_usd}")
    results: dict[str, list[str]] = {}
    spent = 0.0
    for k in range(0, len(js), 50):
        chunk = js[k:k + 50]
        d = call(chunk, round(est * len(chunk) / len(js) * 1.3, 3))
        results.update(d["results"])
        spent += est * len(chunk) / len(js)
        if spent >= a.hard_stop_usd:
            break
    Path(__file__).with_name('proxy_judge_raw.json').write_text(json.dumps(results))  # keep raw replies: a parse failure must not cost a second run
    res = score(results)
    res['empty_or_unparsed'] = sum(1 for v in results.values() if not L.parse_verdict((v or [''])[0]))
    res["est_spent_usd"] = round(spent, 3)
    OUT.write_text(json.dumps(res, indent=1))
    print(res)


if __name__ == "__main__":
    main()
