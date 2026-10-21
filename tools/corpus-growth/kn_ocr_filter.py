#!/usr/bin/env python3
"""Free automated OCR-quality filter for Kannada units: char 4-gram cross-entropy against clean Wikisource text (threshold = 95th percentile
of held-out clean units) plus Kannada orthography rules (broken akshara, invalid conjunct, stray signs). Units that pass and come from PD
kirtana books are promoted to tier A (prompt-eligible); folk/janapada compilations stay tier B.
Usage: kn_ocr_filter.py CLEAN.jsonl REFS_IN.jsonl OUT.jsonl"""
import sys, json, math, re, random, collections

N = 4
CONS = "ಕ-ಹೞ"; VOW = "ಅ-ಔೠೡ"; MATRA = "ಾ-ೌ"; VIR = "್"; SIGN = "ಂಃ"; NUK = "಼"
RULES = [re.compile(p) for p in (
    rf"{VIR}[^{CONS}]",                       # virama must be followed by a consonant (word-final virama is OCR junk in these books)
    rf"[{MATRA}][{MATRA}]",                    # two vowel signs in a row
    rf"(?:^|\s)[{MATRA}{VIR}{SIGN}]",          # sign with no base at word start
    rf"[{VOW}][{MATRA}{VIR}]",                 # independent vowel carrying a matra/virama
    rf"[{SIGN}][{MATRA}{VIR}]",                # matra after anusvara/visarga
    rf"[{CONS}]{VIR}{VIR}|{VIR}[{MATRA}]",      # double virama, virama + matra
    rf"[{CONS}{VOW}{MATRA}][\u0CE6-\u0CEF]|[\u0CE6-\u0CEF][{CONS}{VOW}]",  # digit glued to letters
    rf"[^{CONS}{VOW}{MATRA}{VIR}{SIGN}{NUK}\s\d.,;:!?|೦-೯'\"()\-‌‍]",  # foreign character
)]

def grams(s):
    s = "^" * (N - 1) + s + "$"
    return [(s[i:i + N - 1], s[i + N - 1]) for i in range(len(s) - N + 1)]

class LM:
    def __init__(s, texts):
        s.c, s.h, s.V = collections.Counter(), collections.Counter(), set()
        for t in texts:
            for h, ch in grams(t): s.c[(h, ch)] += 1; s.h[h] += 1; s.V.add(ch)
    def ce(s, t):  # bits per char, add-0.1 smoothing
        g = grams(t); v = len(s.V) + 1
        return -sum(math.log2((s.c[(h, ch)] + .1) / (s.h[h] + .1 * v)) for h, ch in g) / len(g)

def norm(t): return re.sub(r"\s+", " ", re.sub(r"[|।॥\d]+", " ", t)).strip()

def rule_hits(t): return sum(len(r.findall(t)) for r in RULES)

def main(clean, refs, out):
    units = [norm(json.loads(x)["text"]) for x in open(clean) if json.loads(x).get("lang") == "kn"]
    random.Random(1).shuffle(units); cut = int(len(units) * .8)
    lm = LM(units[:cut]); held = sorted(lm.ce(u) for u in units[cut:] if len(u) > 30)
    thr = held[int(len(held) * .95)]; thr_a = held[int(len(held) * .75)]; print("tier A CE cutoff", round(thr_a, 2)); print("clean units", len(units), "held-out CE p50/p95", round(held[len(held) // 2], 2), round(thr, 2))
    st = collections.Counter(); PDK = ("kirtane", "padagalu"); MARK = re.compile(r"ಪಲ್ಲವಿ|ಪಲ್ಲ|ಅನುಪಲ್ಲ|ಚರಣ|॥|ಪ ?[।|]")
    with open(out, "w", encoding="utf-8") as fo:
        for x in map(json.loads, open(refs)):
            if not x.get("ocr"): continue
            t = norm(x["text"]); ce = lm.ce(t); hits = rule_hits(t) / max(1, len(t)) * 100
            ok = ce <= thr and hits <= 0.5
            x["ocr_ce"] = round(ce, 2); x["ocr_rule_hits_per100"] = round(hits, 2); x["ocr_clean"] = ok
            x["tier"] = "A" if ok and ce <= thr and MARK.search(x["text"]) and any(k in x["work"] for k in PDK) else "B"
            st[(x["work"], x["tier"])] += 1; fo.write(json.dumps(x, ensure_ascii=False) + "\n")
    for k, v in sorted(st.items()): print(k, v)

if __name__ == "__main__": main(*sys.argv[1:4])
