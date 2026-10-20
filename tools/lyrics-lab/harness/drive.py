#!/usr/bin/env python3
"""Driver for /api/admin/lyrics-harness (Bearer ADMIN_SECRET in env MA_PROD_ADMIN_SECRET). Stdlib only. Spends money: every paid
subcommand needs --max-usd and refuses without it. Outputs go under --out (default <shared>/lyrics-lab/harness).
  distill --pairs pairs_r2.jsonl --lang kn --max-usd 0.6          -> out/playbooks.json (merged per language)
  run     --arm refs --inputs prod-40.json --max-usd 3            -> out/arm_<arm>.json  {brief_id: {lyrics, trace}}
  drafts  --briefs briefs-fresh.json --inputs-out inputs-fresh.json --max-usd 0.5   -> one plain Haiku draft per fresh brief
  judge   --a arm_refs.json --b arm_live.json --name refs_vs_live --max-usd 2 [--gemini]  -> out/judge_<name>.json
  report  --name refs_vs_live                                     -> win rates, sign test, dims (no spend)
inputs file: {brief_id: {language, style, brief, drafts:[...], pick:int, polished:str}} (prod-40.json from the PCE thread)."""
import argparse, json, math, os, sys, time, urllib.request

BASE = os.environ.get("HARNESS_BASE", "https://www.neo-fm.com")
OUT = os.environ.get("HARNESS_OUT", "/mnt/project-files/lyrics-lab/harness")

def post(action, body, timeout=290):
    req = urllib.request.Request(f"{BASE}/api/admin/lyrics-harness?action={action}", data=json.dumps(body).encode(), method="POST",
        headers={"authorization": f"Bearer {os.environ['MA_PROD_ADMIN_SECRET']}", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r: return json.load(r)

def load(p, default=None):
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else default

def save(p, o):
    os.makedirs(os.path.dirname(p), exist_ok=True); json.dump(o, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

def sign_p(w, l):  # two-sided exact sign test, ties dropped
    n = w + l
    if n == 0: return 1.0
    k = min(w, l); return min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n)

def cmd_distill(a):
    pairs = [json.loads(l) for l in open(a.pairs, encoding="utf-8")]
    pairs = [p for p in pairs if p["lang"] == a.lang][:40]
    names = {"kn": "Kannada", "hi": "Hindi", "ta": "Tamil", "te": "Telugu", "mr": "Marathi", "bn": "Bengali"}
    r = post("distill", {"language": names[a.lang], "pairs": [{k: p[k] for k in ("brief", "chosen", "rejected")} for p in pairs], "max_usd": a.max_usd})
    pb = load(f"{OUT}/playbooks.json", {}); pb[a.lang] = r["playbook"]; save(f"{OUT}/playbooks.json", pb)
    print(a.lang, len(pairs), "pairs", r["spend"])

def cmd_drafts(a):
    """One plain Haiku draft per fresh brief via /api/admin/select-eval?action=drafts (the poet prompt production uses)."""
    briefs = load(a.briefs); out = load(a.inputs_out, {}); todo = [b for b in briefs if b["id"] not in out]
    for i in range(0, len(todo), 10):
        bs = todo[i:i + 10]
        req = urllib.request.Request(f"{BASE}/api/admin/select-eval?action=drafts", method="POST", data=json.dumps({"briefs": bs, "k": 1, "max_usd": a.max_usd}).encode(),
            headers={"authorization": f"Bearer {os.environ['MA_PROD_ADMIN_SECRET']}", "content-type": "application/json"})
        r = json.load(urllib.request.urlopen(req, timeout=290))
        for x in r["results"]:
            b = next(b for b in bs if b["id"] == x["id"])
            out[x["id"]] = {"lang": b["lang"], "language": b["language"], "style": b["style"], "brief": b["text"], "drafts": [x["baseline"]], "pick": 0}
        save(a.inputs_out, out); print(len(out), "drafted", r["spend"], flush=True)

def cmd_run(a):
    inputs = load(a.inputs); pb = load(f"{OUT}/playbooks.json", {})
    path = f"{OUT}/arm_{a.arm}{a.tag}.json"; done = load(path, {}); spent = 0.0
    todo = [k for k in inputs if k not in done or done[k].get("lyrics") is None]
    if a.limit: todo = todo[:a.limit]
    for i in range(0, len(todo), a.chunk):
        if spent >= a.max_usd: print("budget reached"); break
        ids = todo[i:i + a.chunk]
        cases = [{"id": k, "language": inputs[k]["language"], "style": inputs[k]["style"], "brief": inputs[k]["brief"],
                  "drafts": [inputs[k]["drafts"][inputs[k].get("pick", 0)]] + [d for j, d in enumerate(inputs[k]["drafts"]) if j != inputs[k].get("pick", 0)],
                  "playbook": pb.get(inputs[k].get("lang") or k.split("-")[0], "")} for k in ids]
        r = post("run", {"arm": a.arm, "cases": cases, "max_usd": min(a.max_usd - spent, 4)})
        for x in r["results"]: done[x["id"]] = x
        spent += r["spend"]["claude_usd"]; save(path, done)
        print(f"{i + len(ids)}/{len(todo)} spent~{spent:.2f} (route meter undercounts; est ~2x)", flush=True)

def cmd_judge(a):
    A, B = load(f"{OUT}/{a.a}"), load(f"{OUT}/{a.b}") if not a.b.startswith("@") else None
    inputs = load(a.inputs)
    if B is None:  # "@polished" = the production polished lyric stored in the inputs file
        B = {k: {"lyrics": v["polished"]} for k, v in inputs.items()}
    path = f"{OUT}/judge_{a.name}.json"; done = load(path, {}); spent = 0.0
    ids = [k for k in A if A[k].get("lyrics") and B.get(k, {}).get("lyrics") and k not in done]
    for i in range(0, len(ids), 10):
        if spent >= a.max_usd: print("budget reached"); break
        cs = [{"id": k, "language": inputs[k]["language"], "brief": inputs[k]["brief"], "a": A[k]["lyrics"], "b": B[k]["lyrics"]} for k in ids[i:i + 10]]
        r = post("judge", {"cases": cs, "gemini": a.gemini, "max_usd": min(a.max_usd - spent, 4)})
        for x in r["results"]: done[x["id"]] = x
        spent += r["spend"]["claude_usd"]; save(path, done); print(f"{len(done)} judged spent~{spent:.2f}", flush=True)

def cmd_report(a):
    j = load(f"{OUT}/judge_{a.name}.json"); inputs = load(a.inputs) if a.inputs else {}
    for fam in ("claude", "gemini"):
        rows = [(k, v[fam]) for k, v in j.items() if v.get(fam)]
        if not rows: continue
        w = sum(r["winner"] == "pce" for _, r in rows); l = sum(r["winner"] == "single" for _, r in rows); t = len(rows) - w - l
        dims = {}
        for _, r in rows:
            for d, x in (r.get("detail", {}).get("dim_diff") or {}).items(): dims.setdefault(d, []).append(x)
        print(f"{fam}: n={len(rows)} A wins {w} / B wins {l} / ties {t}; rate(ties half)={(w + t / 2) / len(rows):.2f}; sign p={sign_p(w, l):.3f}")
        print("   dim diff (A-B):", {d: round(sum(v) / len(v), 2) for d, v in dims.items()})
        by = {}
        for k, r in rows:
            lg = inputs.get(k, {}).get("lang", k.split("-")[0]); b = by.setdefault(lg, [0, 0, 0])
            b[0 if r["winner"] == "pce" else 1 if r["winner"] == "single" else 2] += 1
        print("   by language (W-L-T):", by)

ap = argparse.ArgumentParser(); sp = ap.add_subparsers(dest="cmd", required=True)
dr = sp.add_parser("drafts"); dr.add_argument("--briefs", required=True); dr.add_argument("--inputs-out", required=True); dr.add_argument("--max-usd", type=float, required=True)
for name in ("distill", "run", "judge"):
    p = sp.add_parser(name); p.add_argument("--max-usd", type=float, required=True)
d = sp.choices["distill"]; d.add_argument("--pairs", required=True); d.add_argument("--lang", required=True)
r = sp.choices["run"]; r.add_argument("--arm", required=True); r.add_argument("--inputs", required=True); r.add_argument("--chunk", type=int, default=3); r.add_argument("--limit", type=int, default=0); r.add_argument("--tag", default="")
j = sp.choices["judge"]; j.add_argument("--a", required=True); j.add_argument("--b", required=True); j.add_argument("--name", required=True); j.add_argument("--inputs", required=True); j.add_argument("--gemini", action="store_true")
p = sp.add_parser("report"); p.add_argument("--name", required=True); p.add_argument("--inputs")
a = ap.parse_args()
{"drafts": cmd_drafts, "distill": cmd_distill, "run": cmd_run, "judge": cmd_judge, "report": cmd_report}[a.cmd](a)
