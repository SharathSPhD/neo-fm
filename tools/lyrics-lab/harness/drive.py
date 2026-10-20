#!/usr/bin/env python3
"""Driver for /api/admin/lyrics-harness (Bearer ADMIN_SECRET in env MA_PROD_ADMIN_SECRET). Stdlib only. Spends money: every paid
subcommand needs --max-usd and refuses without it. Outputs go under --out (default <shared>/lyrics-lab/harness).
  distill --pairs pairs_r2.jsonl --lang kn --max-usd 0.6          -> out/playbooks.json (merged per language)
  run     --arm refs --inputs prod-40.json --max-usd 3            -> out/arm_<arm>.json  {brief_id: {lyrics, trace}}
  gate    --arm refs --cases gate-te.json --name te --max-usd 4          -> formal polish gate, merged across chunks
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

def cmd_gate(a):
    """Formal polish gate (runPolishGate) for one arm over a cases file: [{id,language,style,brief,draft,baseline}]. 5 cases per call."""
    cases = load(a.cases); path = f"{OUT}/gate_{a.arm}_{a.name}.json"; res = load(path, {"chunks": []}); spent = 0.0
    for i in range(len(res["chunks"]) * 5, len(cases), 5):
        if spent >= a.max_usd: print("budget reached"); break
        r = post("gate", {"arm": a.arm, "cases": cases[i:i + 5], "max_usd": min(a.max_usd - spent, 4)})
        res["chunks"].append(r); spent += r["spend"]["claude_usd"]; save(path, res); print(f"{i + 5}/{len(cases)} claude~{spent:.2f}", flush=True)
    tot = {"cand": [0, 0, 0], "live": [0, 0, 0], "gcand": [0, 0, 0], "glive": [0, 0, 0]}
    for r in res["chunks"]:
        for k, src in (("cand", r["candidate"]), ("live", r["live"]), ("gcand", r["gemini"]["candidate"]), ("glive", r["gemini"]["live"])):
            for j, f in enumerate(("pce", "other", "tie")): tot[k][j] += src[f]
    print("W-L-T vs baseline:", tot, "failed", sum(r["failed"] for r in res["chunks"]), "incomplete", any(r["incomplete"] for r in res["chunks"]))
    print("rule: Claude cand wins >= live wins + 3 and Gemini >= +2; per-chunk dims in", path)

def cmd_run(a):
    inputs = load(a.inputs); pb = load(f"{OUT}/playbooks.json", {})
    path = f"{OUT}/arm_{a.arm}.json"; done = load(path, {}); spent = 0.0
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
for name in ("distill", "run", "judge"):
    p = sp.add_parser(name); p.add_argument("--max-usd", type=float, required=True)
d = sp.choices["distill"]; d.add_argument("--pairs", required=True); d.add_argument("--lang", required=True)
r = sp.choices["run"]; r.add_argument("--arm", required=True); r.add_argument("--inputs", required=True); r.add_argument("--chunk", type=int, default=3); r.add_argument("--limit", type=int, default=0)
j = sp.choices["judge"]; j.add_argument("--a", required=True); j.add_argument("--b", required=True); j.add_argument("--name", required=True); j.add_argument("--inputs", required=True); j.add_argument("--gemini", action="store_true")
g = sp.add_parser("gate"); g.add_argument("--arm", required=True); g.add_argument("--cases", required=True); g.add_argument("--name", required=True); g.add_argument("--max-usd", type=float, required=True)
p = sp.add_parser("report"); p.add_argument("--name", required=True); p.add_argument("--inputs")
a = ap.parse_args()
{"distill": cmd_distill, "run": cmd_run, "judge": cmd_judge, "report": cmd_report}[a.cmd](a)
