#!/usr/bin/env python3
"""Score neo-fm public pool songs (fetched from public CDN URLs) with the open-licence scorers: audiobox aesthetics, CLAP text-audio match, Whisper sung-word check.
No reference lyrics are available for most pool songs, so Whisper is reference-free: detected-language match, native-script share, transcript length/word rate, repetition.
usage: score_pool.py pool.json out.jsonl"""
import json, sys, os, re, unicodedata, urllib.request, collections
sys.path.insert(0, os.path.dirname(__file__))
from score_audio import Scorer
pool = json.load(open(sys.argv[1])); out = sys.argv[2]
done = {json.loads(l)["id"] for l in open(out)} if os.path.exists(out) else set()
os.makedirs("pool_audio", exist_ok=True)
SCRIPT = {"hi":"DEVANAGARI","mr":"DEVANAGARI","ta":"TAMIL","te":"TELUGU","kn":"KANNADA","bn":"BENGALI","gu":"GUJARATI","pa":"GURMUKHI","ml":"MALAYALAM","en":"LATIN"}
def script_share(t, lang):
    ch = [c for c in t if c.isalpha()]
    if not ch or lang not in SCRIPT: return None
    return round(sum(SCRIPT[lang] in unicodedata.name(c, "") for c in ch) / len(ch), 3)
S = Scorer("cuda")
with open(out, "a") as f:
    for t in pool:
        if t["id"] in done: continue
        p = f"pool_audio/{t['id']}.mp3"
        try:
            if not os.path.exists(p): __import__("subprocess").run(["curl","-sfL","-o",p,t["url"]],check=True)
            lang = t["language"] if t["language"] in SCRIPT else None
            prompt = f"{t['title']}, {', '.join(t.get('tags', []))}"
            r = {"id": t["id"], "language": t["language"], "title": t["title"], "tags": t.get("tags"), "dur": t.get("durationSeconds"), "url": t["url"]}
            r["aesthetics"] = S.aesthetics([p])[0]
            r["clap_sim"] = S.clap_sim(p, prompt)
            hyp, det = S.transcribe(p, lang)
            w = hyp.split(); toks = collections.Counter(w)
            r["whisper"] = {"transcript": hyp, "lang_detected": det, "lang_match": det == t["language"], "script_share": script_share(hyp, t["language"]),
                            "words": len(w), "words_per_s": round(len(w) / max(1, t.get("durationSeconds") or 1), 3),
                            "distinct_ratio": round(len(toks) / max(1, len(w)), 3)}
        except Exception as e:
            r = {"id": t["id"], "error": repr(e)[:200]}
        f.write(json.dumps(r, ensure_ascii=False) + "\n"); f.flush()
