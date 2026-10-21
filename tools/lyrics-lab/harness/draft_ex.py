#!/usr/bin/env python3
"""Exemplars-in-the-draft-step test: 3 Haiku drafts written WITH 2 judge-picked corpus exemplars in the poet prompt vs the plain 3-draft arm
already produced by draft_k.py (its "short" arm, same briefs, 4000-token drafts). Both go medoid pick -> live Sonnet polish -> blind pair judge
(Claude both orders, optional Gemini both orders). Also reports how much of each exemplar's text reappears in the final song (5-gram overlap).
Uses /api/admin/select-eval (drafts: exemplars, no_baseline; PR with this driver) with Bearer MA_PROD_ADMIN_SECRET. Resumable via --out/state.json.
  python3 draft_ex.py --plain /mnt/project-files/lyrics-lab/draft-k/state.json --briefs briefs-fresh-kn-hi.json --gemini --max-usd 5 --out /mnt/project-files/lyrics-lab/draft-ex
Spend is tracked at 2x the route meter (it undercounts about 2x) and the run stops at --max-usd."""
import argparse, json, math, os, urllib.request

BASE = os.environ.get("HARNESS_BASE", "https://www.neo-fm.com")

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

def grams(s):
    t = "".join(ch for ch in s if not (ch.isspace() or ch in "[]0123456789॥।,.;:!?'\"()-"))
    return {t[i:i + 5] for i in range(max(0, len(t) - 4))}

def overlap(song, others):
    d = grams(song)
    if not d: return 0.0
    o = set().union(*[grams(x) for x in others]) if others else set()
    return len(d & o) / len(d)

def sign_p(w, l):
    n = w + l
    if n == 0: return 1.0
    k = min(w, l); return min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plain", required=True); ap.add_argument("--briefs", required=True)
    ap.add_argument("--out", required=True); ap.add_argument("--max-usd", type=float, required=True)
    ap.add_argument("--exemplars", type=int, default=2); ap.add_argument("--gemini", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True); sp = os.path.join(a.out, "state.json")
    st = json.load(open(sp)) if os.path.exists(sp) else {"spent_x2": 0.0, "cases": {}}
    def save(): json.dump(st, open(sp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    def charge(r):
        st["spent_x2"] += 2 * r["spend"]["claude_usd"]
        if st["spent_x2"] >= a.max_usd: save(); raise SystemExit(f"stop: estimated spend {st['spent_x2']:.2f} reached cap {a.max_usd}")
    plain = {k: c for k, c in json.load(open(a.plain, encoding="utf-8"))["cases"].items() if c.get("done") and c["short"].get("polished")}
    allb = {b["id"]: b for b in json.load(open(a.briefs, encoding="utf-8"))}
    ids = sorted(plain, key=lambda k: (int(k.split("-f")[-1]), k))  # alternate kn/hi so a cap stop leaves both covered
    for i in range(0, len(ids), 2):
        chunk = [k for k in ids[i:i + 2] if "done" not in st["cases"].get(k, {})]
        if not chunk: continue
        bs = [{f: allb[k][f] for f in ("id", "language", "code", "style", "text")} for k in chunk]
        r = post("drafts", {"briefs": bs, "k": 3, "max_tokens": 4000, "exemplars": a.exemplars, "no_baseline": True, "max_usd": 1.0}); charge(r)
        for x in r["results"]:
            ds = [d for d in x["drafts"] if d.strip()]
            c = st["cases"].setdefault(x["id"], {}); c["empty"] = len(x["drafts"]) - len(ds); c["exemplars"] = x.get("exemplars", [])
            if not ds: c["done"] = True; continue
            vecs = post("embed", {"texts": ds})["vectors"]; c["pick"] = ds[medoid(vecs)]
        pol = [{"id": k, "language": allb[k]["language"], "style": allb[k]["style"], "brief": allb[k]["text"], "draft": st["cases"][k]["pick"]} for k in chunk if st["cases"].get(k, {}).get("pick")]
        if pol:
            r = post("polish", {"cases": pol, "max_usd": 1.5}); charge(r)
            for x in r["results"]:
                c = st["cases"][x["id"]]; c["polished"] = x["polished"]
                if x["polished"]: c["overlap"] = overlap(x["polished"], c["exemplars"])
        jp = [{"id": k, "language": allb[k]["language"], "brief": allb[k]["text"], "a": st["cases"][k]["polished"], "b": plain[k]["short"]["polished"]} for k in chunk if st["cases"].get(k, {}).get("polished")]
        if jp:
            r = post("pairs", {"cases": jp, "max_usd": 1.0}); charge(r)
            for x in r["results"]: st["cases"][x["id"]]["judge"] = x["winner"]  # "pce" = first (exemplar arm) won
            if a.gemini:
                g = post("gpairs", {"cases": jp, "max_pairs": 10})
                for x in g["results"]: st["cases"][x["id"]]["gjudge"] = x["winner"]
        for k in chunk: st["cases"][k]["done"] = True
        save(); print(f"{i + len(chunk)}/{len(ids)} est spend {st['spent_x2']:.2f}", flush=True)
    rows = [(k, c) for k, c in st["cases"].items() if c.get("done")]
    def tally(key):
        j = [c.get(key) for _, c in rows if c.get(key)]
        w, l = sum(1 for x in j if x == "pce"), sum(1 for x in j if x == "single")
        return {"judged": len(j), "exemplar_wins": w, "plain_wins": l, "ties": sum(1 for x in j if x == "tie"), "errors": sum(1 for x in j if x == "error"), "sign_p": sign_p(w, l)}
    ov = [c["overlap"] for _, c in rows if "overlap" in c]
    rep = {"briefs": len(rows), "claude": tally("judge"), "gemini": tally("gjudge"), "empty_drafts": sum(c.get("empty", 0) for _, c in rows),
           "overlap_mean": sum(ov) / len(ov) if ov else None, "overlap_max": max(ov) if ov else None, "est_spend_usd": st["spent_x2"]}
    json.dump(rep, open(os.path.join(a.out, "report.json"), "w"), indent=1); print(json.dumps(rep, indent=1))

if __name__ == "__main__":
    main()
