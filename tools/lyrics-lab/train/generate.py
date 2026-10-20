#!/usr/bin/env python3
"""Generate N candidates per brief with a (tuned) model; used for LyricBench evaluation and for preference-pair mining.
python train/generate.py --model unsloth/gemma-3-4b-it [--adapter runs/x/adapter] --briefs bench/briefs.json --n 1 --out arms/T0.json
With --n > 1 the output is {brief_id: [candidates]} (for pairs); with --n 1 it is {brief_id: text} (LyricBench arm file)."""
import argparse, json, os, sys
from unsloth import FastLanguageModel
sys.path.insert(0, os.path.dirname(__file__)); import common
ap = argparse.ArgumentParser()
ap.add_argument("--model", default="unsloth/gemma-3-4b-it"); ap.add_argument("--adapter"); ap.add_argument("--briefs", required=True)
ap.add_argument("--n", type=int, default=1); ap.add_argument("--out", required=True); ap.add_argument("--temp", type=float, default=0.9)
ap.add_argument("--train-briefs-per-lang", type=int, default=0); ap.add_argument("--batch", type=int, default=8)
a = ap.parse_args()
briefs = json.load(open(a.briefs)) if a.train_briefs_per_lang == 0 else common.train_briefs(a.train_briefs_per_lang, exclude={b["brief"] for b in json.load(open(a.briefs))})
model, tok = FastLanguageModel.from_pretrained(a.adapter or a.model, max_seq_length=1024, load_in_4bit=True)
FastLanguageModel.for_inference(model); tok.padding_side = "left"
out = {}
for b in briefs:
    msgs = [{"role": "user", "content": common.song_prompt(b["lang"], b["style"], b["brief"])}]
    ids = tok.apply_chat_template(msgs, add_generation_prompt=True, return_tensors="pt", return_dict=True).to("cuda")
    cands = []
    while len(cands) < a.n:
        k = min(a.batch, a.n - len(cands))
        g = model.generate(**ids, max_new_tokens=300, do_sample=True, temperature=a.temp, top_p=0.95, num_return_sequences=k)
        cands += [tok.decode(x[ids["input_ids"].shape[1]:], skip_special_tokens=True).strip() for x in g]
    out[b["id"]] = cands[0] if a.n == 1 else {"brief": b, "cands": cands}
    print(b["id"], flush=True)
json.dump(out, open(a.out, "w"), ensure_ascii=False, indent=1)
