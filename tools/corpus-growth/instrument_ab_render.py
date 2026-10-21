#!/usr/bin/env python3
"""Paired instrument A/B on the Lyria clip model (~30 s, est. GBP 0.05 each) through the prod admin route /api/admin/test-render
(prod's server-side key; the cloud-session key has no Lyria access and gets 403). Per instrument: BASE prompt vs the same prompt
naming the instrument. Needs MA_PROD_ADMIN_SECRET (HARNESS_BASE optional); a live run calls prod, so run it only with S's tap.
Writes OUT/<instrument>-{base,named}.mp3 and OUT/renders.json; score the pairs with instrument_probe.py.
Usage: instrument_ab_render.py OUT [--dry] [--only veena,sitar]"""
import json, os, sys, urllib.request

BASE_URL = os.environ.get("HARNESS_BASE", "https://www.neo-fm.com")
INSTR = ["veena", "sitar", "flute", "violin", "santoor", "nadaswaram"]
BASE = "Instrumental only, no vocals, no humming. A calm devotional morning piece, soft pads and a gentle steady pulse, 30 seconds."


def prompts(i):
    return {"base": BASE, "named": BASE.replace("soft pads", f"a prominent solo {i} carrying the melody over soft pads")}


def call(items):
    req = urllib.request.Request(f"{BASE_URL}/api/admin/test-render", data=json.dumps({"items": items}).encode(), method="POST",
                                 headers={"authorization": f"Bearer {os.environ['MA_PROD_ADMIN_SECRET']}", "content-type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=290))


def main():
    out = sys.argv[1]
    only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else INSTR
    log = []
    for i in only:
        items = [{"label": f"instab-{i}-{arm}", "language": "en", "lyrics": "[Instrumental]", "style": pr, "clip": True, "hints": False} for arm, pr in prompts(i).items()]
        if "--dry" in sys.argv:
            print(json.dumps(items))
            continue
        os.makedirs(out, exist_ok=True)
        body = call(items)
        for it, r in zip(items, body.get("results", [])):
            arm = it["label"].rsplit("-", 1)[1]
            f = None
            if r.get("url"):
                f = f"{i}-{arm}.mp3"
                open(os.path.join(out, f), "wb").write(urllib.request.urlopen(r["url"], timeout=120).read())
            log.append({"instrument": i, "arm": arm, "prompt": it["style"], "file": f, "err": r.get("error"), "est_cost_gbp": body.get("est_cost_gbp")})
            print(i, arm, f or r.get("error"), flush=True)
    if "--dry" not in sys.argv:
        json.dump(log, open(os.path.join(out, "renders.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
