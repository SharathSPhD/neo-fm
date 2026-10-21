#!/usr/bin/env python3
"""Song-form ref candidates from proofread Wikisource pages (wikisource_pages.py output) of pre-modern pad/kirtana/dohavali works.
Allowlist by work title (author death <= 1964 or traditional), score with free lyricmetrics `det`, keep pages with det >= MIN.
Usage: pad_refs.py LANG PAGES.jsonl OUT.jsonl [MIN]"""
import sys, re, json, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lyrics-lab", "bench"))
from lyricmetrics import score

WORKS = {
    "hi": r"विनय पत्रिका|पदुमावति|पद्मावत|सूरसागर|सूर-?सागर|भ्रमरगीत|कबीर|मीरा|मीरां|रामचरितमानस|गीतावली|कवितावली|दोहावली|रहीम|बिहारी|पदावली|रैदास|रत्नाकर|हरिऔध|प्रिय ?प्रवास|साकेत",
    "kn": r"ಕನಕದಾಸ|ಪುರಂದರ|ದಾಸ ?ಸಾಹಿತ್ಯ|ದಾಸರ|ಹರಿಕಥಾಮೃತ|ಯಕ್ಷಗಾನ|ಜನಪದ|ಕೀರ್ತನ|ಸರ್ವಜ್ಞ",
}
# modern in-copyright authors that the title regex could catch
DENY = {"hi": r"साकेत|प्रिय ?प्रवास", "kn": r"$^"}  # Gupta d.1964 is PD but his editions are modern; Hariaudh handled in tier A already

def main(lang, src, out, mn=60):
    keep = re.compile(WORKS[lang]); n = tot = 0
    with open(src, encoding="utf-8") as f, open(out, "w", encoding="utf-8") as fo:
        for line in f:
            r = json.loads(line)
            if not keep.search(r.get("title", "") + " " + r.get("book", "")) or re.search(DENY[lang], r.get("title", "")): continue
            if lang == "kn" and len(re.findall(r"ಡಾ\.|ಶ್ರೀ |ಪ್ರಕಾಶಕ|ಮುದ್ರಣ|ಸಂಪಾದಕ|ಅಧ್ಯಕ್ಷ|ಸದಸ್ಯ|ಸಂಪುಟ", r["text"])) >= 2: continue
            tot += 1
            try: m = score(r["text"], lang)
            except Exception: continue
            if (m.get("det") or 0) < float(mn): continue
            n += 1
            fo.write(json.dumps({"id": r["id"].replace("wsp", "pad"), "lang": lang, "work": r.get("title"), "author": r.get("author"), "page": r.get("page"), "text": r["text"], "det": m["det"], "tier": "B", "license": "PD work; Wikisource proofread text CC BY-SA"}, ensure_ascii=False) + "\n")
    print(lang, "candidate pages", tot, "kept", n)

if __name__ == "__main__": main(*sys.argv[1:])
