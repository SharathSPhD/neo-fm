#!/usr/bin/env python3
"""Paired instrument A/B on the Lyria clip model (~30 s, est. GBP 0.05 each). Per instrument: BASE prompt vs the same prompt with the instrument named.
Writes OUT/<name>-{base,named}.<ext> and OUT/renders.json. Needs GEMINI_API_KEY. Usage: instrument_ab_render.py OUT [--dry]"""
import base64, json, os, sys, urllib.request, time
INSTR = ["veena", "sitar", "flute", "violin", "santoor", "nadaswaram"]
BASE = "Instrumental only, no vocals, no humming. A calm devotional morning piece, soft pads and a gentle steady pulse, 30 seconds."
def prompts(i): return {"base": BASE, "named": BASE.replace("soft pads", f"a prominent solo {i} carrying the melody over soft pads")}
def render(prompt):
    req = urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/models/lyria-3-clip-preview:generateContent",
        data=json.dumps({"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseModalities": ["AUDIO", "TEXT"]}}).encode(),
        headers={"content-type": "application/json", "x-goog-api-key": os.environ["GEMINI_API_KEY"]})
    for a in range(2):
        try:
            b = json.load(urllib.request.urlopen(req, timeout=180))
            p = next(p for p in b["candidates"][0]["content"]["parts"] if "inlineData" in p)["inlineData"]
            return p["mimeType"], base64.b64decode(p["data"])
        except Exception as e:
            err = str(e); time.sleep(3)
    return None, err
out = sys.argv[1]; os.makedirs(out, exist_ok=True); log = []
for i in INSTR:
    for arm, pr in prompts(i).items():
        if "--dry" in sys.argv: print(i, arm, pr); continue
        mt, data = render(pr); ok = mt is not None
        name = f"{i}-{arm}.{'wav' if ok and 'wav' in mt else 'mp3'}"
        if ok: open(os.path.join(out, name), "wb").write(data)
        log.append({"instrument": i, "arm": arm, "prompt": pr, "file": name if ok else None, "mime": mt, "err": None if ok else str(data)[:200]}); print(name, ok, flush=True)
if "--dry" not in sys.argv: json.dump(log, open(os.path.join(out, "renders.json"), "w"), indent=1)
