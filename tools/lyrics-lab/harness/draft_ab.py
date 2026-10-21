#!/usr/bin/env python3
"""Before/after test of the poet-draft token limit (1500 vs 4000) through the production-shaped pipeline:
6 Haiku drafts -> embedding pick (draft closest to the others) -> live Sonnet polish -> blind Claude pair judge, both orders.
Uses /api/admin/select-eval (drafts needs max_tokens support, PR #457) with Bearer MA_PROD_ADMIN_SECRET. Stdlib only. Resumable: state in --out/state.json.
  python3 draft_ab.py --briefs briefs-fresh-kn-hi.json --per-lang 10 --max-usd 6 --out /mnt/project-files/lyrics-lab/draft-ab
Route meters undercount about 2x, so spend is tracked at 2x the reported number and the run stops at --max-usd."""
import argparse, json, math, os, urllib.request

BASE = os.environ.get("HARNESS_BASE", "https://www.neo-fm.com")
ARMS = {"short": 1500, "long": 4000}

def post(action, body, timeout=295):
    req = urllib.request.Request(f"{BASE}/api/admin/select-eval?action={action}", data=json.dumps(body).encode(), method="POST",
        headers={"authorization": f"Bearer {os.environ['MA_PROD_ADMIN_SECRET']}", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r: return json.load(r)

def cos(u, v):
    d = sum(x * y for x, y in zip(u, v)); n = math.sqrt(sum(x * x for x in u)) * math.sqrt(sum(y * y for y in v))
    return d / n if n else 0.0

def medoid(vecs):
    if len(vecs) == 1: return 0
    return max(range(len(vecs)), key=lambda i: sum(cos(vecs[i], vecs[j]) for j in range(len(vecs)) if j != i))

def sign_p(w, l):
    n = w + l
    if n == 0: return 1.0
    k = min(w, l); return min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--briefs", required=True); ap.add_argument("--per-lang", type=int, default=10)
    ap.add_argument("--max-usd", type=float, required=True); ap.add_argument("--out", required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True); sp = os.path.join(a.out, "state.json")
    st = json.load(open(sp)) if os.path.exists(sp) else {"spent_x2": 0.0, "cases": {}}
    def save(): json.dump(st, open(sp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    def charge(r):
        st["spent_x2"] += 2 * r["spend"]["claude_usd"]
        if st["spent_x2"] >= a.max_usd: save(); raise SystemExit(f"stop: estimated spend {st['spent_x2']:.2f} reached cap {a.max_usd}")
    allb = json.load(open(a.briefs, encoding="utf-8")); seen = {}
    briefs = [b for b in allb if seen.setdefault(b["lang"], 0) < a.per_lang and not seen.__setitem__(b["lang"], seen[b["lang"]] + 1)]
    for i in range(0, len(briefs), 2):  # 2 briefs per call keeps each call under the route's 300 s
        chunk = [b for b in briefs[i:i + 2] if "done" not in st["cases"].get(b["id"], {})]
        if not chunk: continue
        bs = [{k: b[k] for k in ("id", "language", "code", "style", "text")} for b in chunk]
        for arm, mt in ARMS.items():
            r = post("drafts", {"briefs": bs, "k": 6, "max_tokens": mt, "max_usd": 1.0}); charge(r)
            for x in r["results"]: st["cases"].setdefault(x["id"], {})[arm] = {"drafts": x["drafts"]}
        for b in chunk:
            c = st["cases"][b["id"]]
            for arm in ARMS:
                ds = [d for d in c[arm]["drafts"] if d.strip()]
                c[arm]["empty"] = len(c[arm]["drafts"]) - len(ds); c[arm]["short"] = sum(1 for d in ds if len(d) < 150)
                if not ds: c[arm]["pick"] = None; continue
                e = post("embed", {"texts": ds}); vecs = e.get("vectors") or e.get("embeddings") or e.get("data")
                c[arm]["pick"] = ds[medoid(vecs)]
        pol = []
        for b in chunk:
            for arm in ARMS:
                if st["cases"][b["id"]][arm]["pick"]: pol.append({"id": f"{b['id']}|{arm}", "language": b["language"], "style": b["style"], "brief": b["text"], "draft": st["cases"][b["id"]][arm]["pick"]})
        r = post("polish", {"cases": pol, "max_usd": 1.5}); charge(r)
        for x in r["results"]:
            bid, arm = x["id"].split("|"); st["cases"][bid][arm]["polished"] = x["polished"]
        jp = [{"id": b["id"], "language": b["language"], "brief": b["text"], "a": st["cases"][b["id"]]["long"].get("polished") or "", "b": st["cases"][b["id"]]["short"].get("polished") or ""} for b in chunk
              if st["cases"][b["id"]]["long"].get("polished") and st["cases"][b["id"]]["short"].get("polished")]
        if jp:
            r = post("pairs", {"cases": jp, "max_usd": 1.0}); charge(r)
            for x in r["results"]: st["cases"][x["id"]]["judge"] = x["winner"]  # "pce" = first (long) won
        for b in chunk: st["cases"][b["id"]]["done"] = True
        save(); print(f"{i + len(chunk)}/{len(briefs)} est spend {st['spent_x2']:.2f}", flush=True)
    rows = list(st["cases"].items())
    j = [c.get("judge") for _, c in rows if c.get("judge")]
    w, l = sum(1 for x in j if x == "pce"), sum(1 for x in j if x not in ("pce", "tie", "error"))
    rep = {"briefs": len(rows), "judged": len(j), "long_wins": w, "short_wins": l, "ties": sum(1 for x in j if x == "tie"), "sign_p": sign_p(w, l),
           "empty_drafts": {arm: sum(c[arm]["empty"] for _, c in rows) for arm in ARMS}, "short_drafts": {arm: sum(c[arm]["short"] for _, c in rows) for arm in ARMS},
           "est_spend_usd": st["spent_x2"]}
    json.dump(rep, open(os.path.join(a.out, "report.json"), "w"), indent=1); print(json.dumps(rep, indent=1))

if __name__ == "__main__":
    main()
