#!/usr/bin/env python3
"""Memorisation gate. build: write the set of word 4-grams of a corpus. ratio(): share of a text's 4-grams found in the corpus.
Generated lyrics above MAX_RATIO must be rejected (GEMA v OpenAI risk: memorised lyrics infringe). Usage: overlap.py build IN.jsonl OUT.txt"""
import sys, json, re
MAX_RATIO = 0.15
def grams(text, n=4):
    w = re.findall(r"[^\W\d_]+", text.lower())
    return {" ".join(w[i:i + n]) for i in range(len(w) - n + 1)}
def load(path): return set(open(path, encoding="utf-8").read().split("\n"))
def ratio(text, corpus_grams):
    g = grams(text)
    return 0.0 if not g else len(g & corpus_grams) / len(g)
if __name__ == "__main__" and sys.argv[1] == "build":
    out = set()
    for l in open(sys.argv[2], encoding="utf-8"): out |= grams(json.loads(l)["text"])
    open(sys.argv[3], "w", encoding="utf-8").write("\n".join(sorted(out))); print(len(out), "4-grams")
