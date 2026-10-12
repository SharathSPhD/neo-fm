#!/usr/bin/env python3
"""Build the native-reviewer packet (CSV + README) from the sweep lyrics and the saved review audio.
usage: make-reviewer-packet.py <audio_dir> <out_dir>"""
import csv, json, os, random, re, sys
audio, out = sys.argv[1], sys.argv[2]
here = os.path.dirname(__file__)
items = {i["id"]: i for i in json.load(open(os.path.join(here, "lyrics-fullB-n10.json")))}
SEC = re.compile(r"^(#|\*\*.*\*\*$|\[.*\]$)")
def sung(t): return "\n".join(l for l in t.split("\n") if l.strip() and not SEC.match(l.strip()) and len(l.split()) > 2)
ids = sorted(f.rsplit(".", 1)[0] for f in os.listdir(audio))
random.Random(7).shuffle(ids)  # blind order: reviewers must not see language grouping bias or scores
os.makedirs(out, exist_ok=True)
cols = ["clip", "language", "lyrics", "stress_meter_1to5", "word_boundary_1to5", "vowel_length_1to5", "melody_fit_1to5", "overall_singable_1to5", "worst_line_no", "notes"]
with open(os.path.join(out, "reviewer-sheet.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f); w.writerow(cols)
    for n, i in enumerate(ids, 1):
        w.writerow([f"clip-{n:02d} ({i}.mp3)", items[i]["language"], sung(items[i]["lyrics"]), "", "", "", "", "", "", ""])
print(len(ids), "rows")
