"""Build apps/web/lib/lab/showcase-audio.json from judged render pairs (no model calls, no spend) and pack the clips.

Sources, all under lab/render-harness (shared folder): validation/ (E3-E7: stock native+ITRANS input vs Claude-romanized
Latin input, Gemini sung-word match) and e8/ (stock style line vs catalog-cue style line, with free scorer deltas from plan.md).
Usage: python3 build_showcase_audio.py [LAB_DIR] [OUT_JSON] [PACK_DIR]
Clips are packed as mono 64 kbps mp3 into PACK_DIR, named <label>.mp3, for upload under the showcase audio base URL.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

LAB = Path(sys.argv[1] if len(sys.argv) > 1 else "/mnt/project-files/lab/render-harness")
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).resolve().parents[3] / "apps/web/lib/lab/showcase-audio.json")
PACK = Path(sys.argv[3]) if len(sys.argv) > 3 else None

LANG = {"ta": "Tamil", "te": "Telugu", "kn": "Kannada", "hi": "Hindi"}
# Stock (native + ITRANS, hints on) vs Claude-romanized Latin-only input, same brief and lyrics; every render of both arms is listed.
ROMAN = [
    ("occ-ta-1", "ta", ["e3-ta-a-1", "e3-ta-a-2"], ["e5-ta-rom-1", "e5-ta-rom-2", "e5-ta-rom-3"]),
    ("occ-te-1", "te", ["e3-te-a-1", "e3-te-a-2"], ["e5-te-rom-1", "e5-te-rom-2", "e5-te-rom-3"]),
    ("occ-kn-1", "kn", ["e6-kn-stock-1", "e6-kn-stock-2"], ["e6-kn-rom-1", "e6-kn-rom-2"]),
]
# E8 free scorer deltas (cue minus stock), copied from render-harness/plan.md "E8 free audio scores".
E8_SCORES = {
    "occ-kn-1": {"audiobox_ce": 0.15, "audiobox_cu": -0.03, "audiobox_pc": -0.23, "audiobox_pq": 0.09, "pref_logit": -0.49, "clap_cos": 0.971},
    "occ-kn-2": {"audiobox_ce": -0.15, "audiobox_cu": -0.03, "audiobox_pc": 0.22, "audiobox_pq": -0.09, "pref_logit": -0.11, "clap_cos": 0.993},
    "occ-hi-2": {"audiobox_ce": 0.13, "audiobox_cu": 0.04, "audiobox_pc": 0.26, "audiobox_pq": 0.11, "pref_logit": -0.72, "clap_cos": 0.986},
}


def main() -> None:
    man = {r["label"]: r for r in json.loads((LAB / "validation/manifest.json").read_text(encoding="utf-8"))}
    e8 = {r["label"]: r for r in json.loads((LAB / "e8/manifest.json").read_text(encoding="utf-8"))}
    files: dict[str, Path] = {}

    def render(label: str) -> dict:
        files[label] = LAB / "validation/audio" / Path(man[label]["audio"]).name
        return {"clip": label, "diction": man[label]["gemini_match_pct"]}

    roman = []
    for brief, lang, stock, rom in ROMAN:
        roman.append({
            "brief": brief, "lang": lang, "language": LANG[lang],
            "lyrics": man[rom[0]]["intended_lyrics_native"].strip(),
            "stock": [render(x) for x in stock], "romanized": [render(x) for x in rom],
        })
    cue = []
    for brief, scores in E8_SCORES.items():
        a, c = f"e8-{brief}-a", f"e8-{brief}-c"
        for lab in (a, c):
            files[lab] = LAB / "e8" / f"{lab}.mp3"
        cue.append({"brief": brief, "lang": brief.split("-")[1], "language": LANG[brief.split("-")[1]],
                    "stock": {"clip": a, "diction": e8[a]["diction_match_pct"]}, "cue": {"clip": c, "diction": e8[c]["diction_match_pct"]},
                    "scores": scores})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"source": "lab/render-harness E3-E8, 2026-10-20/21", "romanization": roman, "cue": cue}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(len(roman), "romanization groups,", len(cue), "cue pairs ->", OUT)
    if PACK:
        PACK.mkdir(parents=True, exist_ok=True)
        for label, src in sorted(files.items()):
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-ac", "1", "-b:a", "64k", str(PACK / f"{label}.mp3")], check=True)
        print(len(files), "clips packed ->", PACK)


main()
