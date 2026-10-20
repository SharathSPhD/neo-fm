#!/usr/bin/env python3
"""Download licence-listed open datasets used for tuning and reward work (needs internet; some are gated, request access first).
Writes JSONL under data/hf/. Licences per 07-open-corpora-text-and-audio.md. Usage: fetch_hf.py aya | sangraha | arena"""
import sys, json, os
from datasets import load_dataset
LANGS = {"kn": "kan", "hi": "hin", "te": "tel", "ta": "tam", "mr": "mar"}
os.makedirs("data/hf", exist_ok=True)
def aya():
    ds = load_dataset("CohereLabs/aya_dataset", split="train")  # apache-2.0, 204k human prompt/completion pairs
    keep = set(LANGS.values())
    with open("data/hf/aya_indic.jsonl", "w", encoding="utf-8") as f:
        n = 0
        for r in ds:
            if r["language_code"] in keep: f.write(json.dumps(r, ensure_ascii=False) + "\n"); n += 1
    print("aya indic rows", n)
def sangraha(max_docs=200000):
    # cc-by-4.0 compiler label, web-crawl underneath: fluency only, never lyrics; honour opt-outs
    for l in LANGS:
        ds = load_dataset("ai4bharat/sangraha", data_dir=f"verified/{l}", split="train", streaming=True)
        with open(f"data/hf/sangraha_{l}.jsonl", "w", encoding="utf-8") as f:
            for i, r in enumerate(ds):
                if i >= max_docs // 5: break
                f.write(json.dumps({"lang": l, "text": r["text"]}, ensure_ascii=False) + "\n")
def arena():
    from huggingface_hub import snapshot_download
    print(snapshot_download("music-arena/music-arena-dataset", repo_type="dataset", local_dir="data/hf/music-arena"))
if __name__ == "__main__": {"aya": aya, "sangraha": sangraha, "arena": arena}[sys.argv[1]]()
