#!/usr/bin/env python3
"""Judged lyric corpus growth (stdlib only; same env as harness/drive.py: MA_PROD_ADMIN_SECRET, HARNESS_BASE).
  harvest --langs kn,hi,ta,mr --per-lang 100        free: merge mined teacher targets, prior judged items and the eval_runs archive -> candidates.jsonl
  score   --max-usd 3 [--gemini]                      paid: pointwise Claude (+Gemini) scores for the candidates, resumable -> scores.jsonl
  build   --exemplars-out F --pairs-out F             free: corpus.jsonl (text, provenance, both judges), refreshed exemplars.json and pairs for `drive.py distill`
Store: $CORPUS_DIR (default /mnt/project-files/lyrics-lab/corpus). Briefs that near-duplicate a LyricBench brief are never admitted."""
import argparse, hashlib, json, os, re, sys, urllib.request

BASE = os.environ.get("HARNESS_BASE", "https://www.neo-fm.com")
LAB = os.environ.get("LAB_DIR", "/mnt/project-files/lyrics-lab")
STORE = os.environ.get("CORPUS_DIR", f"{LAB}/corpus")
NAMES = {"kn": "kannada", "hi": "hindi", "ta": "tamil", "mr": "marathi", "te": "telugu", "bn": "bengali"}
CODES = {v: k for k, v in NAMES.items()}
DIMS = ("prosody", "diction", "imagery", "cultural", "originality")

def post(action, body, timeout=290):
    req = urllib.request.Request(f"{BASE}/api/admin/lyrics-harness?action={action}", data=json.dumps(body).encode(), method="POST",
        headers={"authorization": f"Bearer {os.environ['MA_PROD_ADMIN_SECRET']}", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r: return json.load(r)

def rows(p):
    return [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()] if os.path.exists(p) else []

def put(p, rs, mode="w"):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, mode, encoding="utf-8") as f:
        for r in rs: f.write(json.dumps(r, ensure_ascii=False) + "\n")

def sha(t): return hashlib.sha256(re.sub(r"\s+", " ", t).strip().encode()).hexdigest()[:16]
def toks(s): return set(re.findall(r"[a-z]{3,}", s.lower()))

def cmd_harvest(a):
    langs = a.langs.split(",")
    bench = [toks(b["brief"]) for b in json.load(open(f"{LAB}/bench/briefs.json"))]
    def overlaps(brief):
        t = toks(brief); return any(len(t & b) / max(1, len(t | b)) >= 0.5 for b in bench)
    prior = {r["id"]: r for r in rows(f"{LAB}/data/mined/sft_r2.jsonl")}
    cands, seen, drop = [], set(), {"dup": 0, "bench": 0, "short": 0}
    def add(c):
        if len(c["text"].strip()) < 60: drop["short"] += 1; return
        c["sha"] = sha(c["text"])
        if c["sha"] in seen: drop["dup"] += 1; return
        if overlaps(c["brief"]): drop["bench"] += 1; return
        seen.add(c["sha"]); c["id"] = f'{c["lang"]}-{c["sha"][:10]}'; cands.append(c)
    arch = post("archive", {"languages": [NAMES[l] for l in langs], "limit": 3000})["rows"]
    for r in arch:  # production songs first: distinct, real traffic
        add({"lang": CODES.get(r["language"].lower(), r["language"]), "style": r.get("style_family") or "", "brief": r["brief"], "text": r["lyrics"].strip(),
             "provenance": {"source": "eval-archive", "arm": r["arm"], "batch": r["batch"], "brief_id": r["brief_id"], "writer": "claude-pce" if r["arm"] == "pce" else "claude-single", "created_at": r["created_at"]}})
    for r in prior.values():
        if r["lang"] in langs:
            add({"lang": r["lang"], "style": r["style"], "brief": r["brief"], "text": r["text"].strip(), "prior_judge": r["judge"],
                 "provenance": {"source": "mined-sft_r2", "ref": r["id"], "writer": "gemini-teacher", "listwise_judge": r["judge"]}})
    for r in sorted(rows(f"{LAB}/data/mined/sft_all.jsonl"), key=lambda r: -r["reward"]):
        if r["lang"] in langs:
            add({"lang": r["lang"], "style": r["style"], "brief": r["brief"], "text": r["text"].strip(),
                 "provenance": {"source": "mined-sft_all", "ref": r["id"], "writer": "gemini-teacher", "metric_reward": r["reward"]}})
    pri = {"eval-archive": 0, "mined-sft_r2": 1, "mined-sft_all": 2}
    out, per = [], {}
    for c in sorted(cands, key=lambda c: pri[c["provenance"]["source"]]):  # stable: keeps reward order inside a source
        if per.get(c["lang"], 0) < a.per_lang: out.append(c); per[c["lang"]] = per.get(c["lang"], 0) + 1
    put(f"{STORE}/candidates.jsonl", out)
    by = {}
    for c in out: by.setdefault(c["lang"], {}).setdefault(c["provenance"]["source"], 0); by[c["lang"]][c["provenance"]["source"]] += 1
    print("candidates", len(out), by, "dropped", drop)

def cmd_score(a):
    cands, done = rows(f"{STORE}/candidates.jsonl"), {r["id"]: r for r in rows(f"{STORE}/scores.jsonl")}
    todo = [c for c in cands if c["id"] not in done or (a.gemini and done[c["id"]].get("gemini") is None)]
    spent, prev = 0.0, 0.0
    print("to score", len(todo), "of", len(cands))
    for i in range(0, len(todo), 40):
        chunk = todo[i:i + 40]
        left = a.max_usd - spent
        if left <= 0.05: print("budget reached"); break
        r = post("score", {"items": [{"id": c["id"], "language": NAMES[c["lang"]], "brief": c["brief"], "lyrics": c["text"]} for c in chunk], "gemini": a.gemini, "max_usd": left})
        got = [{"id": k, "claude": v.get("claude"), "gemini": v.get("gemini")} for k, v in r["results"].items()]
        put(f"{STORE}/scores.jsonl", got, "a")
        cur = float(r["spend"].get("claude_usd", 0))  # per-instance meter: cumulative on a warm instance, restarts on a cold one
        spent += cur - prev if cur >= prev else cur
        prev = cur
        print(f"chunk {i // 40}: {r['n']}/{r['requested']} scored, route meter so far {r['spend']}")
        if r["skipped_for_budget"]: print("route stopped for budget"); break

def mean(s): return s["mean"] if s else None

def cmd_build(a):
    cands = rows(f"{STORE}/candidates.jsonl")
    sc = {}
    for r in rows(f"{STORE}/scores.jsonl"):  # last write wins
        sc[r["id"]] = r
    out = []
    for c in cands:
        s = sc.get(c["id"])
        if not s or not s.get("claude"): continue
        cm, gm = mean(s["claude"]), mean(s.get("gemini"))
        c = dict(c, claude=s["claude"], gemini=s.get("gemini"))
        c["pass"] = cm >= a.min_judge and (gm is None or gm >= a.min_judge)
        c["score"] = round(min(cm, gm) if gm is not None else cm, 2)
        out.append(c)
    put(f"{STORE}/corpus.jsonl", out)
    by = {}
    for c in out:
        b = by.setdefault(c["lang"], [0, 0]); b[0] += 1; b[1] += c["pass"]
    print("corpus", len(out), {k: f"{v[1]}/{v[0]} pass" for k, v in by.items()})
    if a.exemplars_out:
        ex = []
        for lang in sorted(by):
            good = sorted([c for c in out if c["lang"] == lang and c["pass"]], key=lambda c: -c["score"])[:a.max_exemplars]
            ex += [{"id": c["id"], "lang": c["lang"], "style": c["style"], "brief": c["brief"], "text": c["text"], "judge": c["score"]} for c in good]
        old = json.load(open(a.exemplars_out)) if os.path.exists(a.exemplars_out) else []
        keep = [e for e in old if e["lang"] not in by]  # languages not regrown stay as they were
        json.dump(keep + ex, open(a.exemplars_out, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
        print("exemplars", len(keep + ex), {l: sum(e["lang"] == l for e in ex) for l in by})
    if a.pairs_out:
        ps = []
        for lang in by:
            pool = sorted([c for c in out if c["lang"] == lang], key=lambda c: -c["score"])
            top, bot = [c for c in pool if c["pass"]][:a.pairs], list(reversed([c for c in pool if not c["pass"]]))[:a.pairs]
            for g, b in zip(top, bot): ps.append({"id": f'{g["id"]}>{b["id"]}', "lang": lang, "style": g["style"], "brief": g["brief"], "chosen": g["text"], "rejected": b["text"], "margin": round(g["score"] - b["score"], 2)})
        put(a.pairs_out, ps)
        print("pairs", len(ps))

p = argparse.ArgumentParser(); sp = p.add_subparsers(dest="cmd", required=True)
h = sp.add_parser("harvest"); h.add_argument("--langs", default="kn,hi,ta,mr"); h.add_argument("--per-lang", type=int, default=100)
s = sp.add_parser("score"); s.add_argument("--max-usd", type=float, required=True); s.add_argument("--gemini", action="store_true")
b = sp.add_parser("build"); b.add_argument("--min-judge", type=float, default=3.5); b.add_argument("--max-exemplars", type=int, default=50)
b.add_argument("--pairs", type=int, default=40); b.add_argument("--exemplars-out"); b.add_argument("--pairs-out")
a = p.parse_args()
{"harvest": cmd_harvest, "score": cmd_score, "build": cmd_build}[a.cmd](a)
