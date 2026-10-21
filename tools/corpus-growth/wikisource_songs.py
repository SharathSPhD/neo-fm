#!/usr/bin/env python3
"""Song-form PD refs: pull lyric-form Wikisource pages by title prefix (Hindi pad collections, Kannada single-song/dasa pages),
gate by pre-modern author/work, score with the free lyricmetrics `det`, write ref candidates.
Usage: wikisource_songs.py DUMP.xml.bz2 LANG OUT.jsonl"""
import bz2, sys, re, json, hashlib, os, xml.etree.ElementTree as ET
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lyrics-lab", "bench"))
sys.path.insert(0, os.path.dirname(__file__))
from wikisource_extract import clean
from lyricmetrics import score

# pre-modern works / collections only (author death <= 1964 or anonymous folk); extend deliberately, never by wildcard
PREFIX = {
    "hi": [r"भ्रमरगीत-सार", r"जायसी ग्रंथावली", r"कबीर ग्रंथावली", r"कबीर", r"सूरदास", r"मीरां|मीरा", r"रैदास", r"तुलसी", r"प्रताप पीयूष", r"आल्हखण्ड", r"विद्यापति", r"बिहारी", r"रहीम"],
    "kn": [r"ಪುರಂದರ", r"ಕನಕದಾಸ", r"ಕನಕ", r"ಹರಿಕಥಾಮೃತಸಾರ", r"ದಾಸ ಸಾಹಿತ್ಯ", r"ವಿಜಯದಾಸ", r"ಗೋಪಾಲದಾಸ", r"ಜಗನ್ನಾಥದಾಸ", r"ಜನಪದ", r"ಸರ್ವಜ್ಞ", r"ಬಸವಣ್ಣ", r"ಅಕ್ಕಮಹಾದೇವಿ", r"ಕುಮಾರವ್ಯಾಸ"],
}

def main(dump, lang, out):
    pre = re.compile("^(" + "|".join(PREFIX[lang]) + ")"); seen, n = set(), 0
    with bz2.open(dump, "rb") as f, open(out, "w", encoding="utf-8") as fo:
        for _, el in ET.iterparse(f):
            if not el.tag.endswith("}page"): continue
            ns = el.find("{*}ns").text; title = el.findtext("{*}title") or ""; txt = el.findtext("{*}revision/{*}text") or ""
            redirect = el.find("{*}redirect") is not None; el.clear()
            if ns != "0" or redirect or not pre.match(title): continue
            body = clean(txt); ls = [l for l in body.split("\n") if l.strip()]
            if not 4 <= len(ls) <= 60 or sum(map(len, ls)) / len(ls) > 60: continue
            h = hashlib.sha1(body.encode()).hexdigest()
            if h in seen: continue
            seen.add(h)
            try: m = score(body, lang)
            except Exception: continue
            n += 1
            fo.write(json.dumps({"id": f"wsong-{lang}-{h[:10]}", "lang": lang, "title": title, "text": body, "n_lines": len(ls), "det": m.get("det"), "license": "PD pre-modern; Wikisource text CC BY-SA edition", "tier": "B"}, ensure_ascii=False) + "\n")
    print(lang, "kept", n)

if __name__ == "__main__": main(*sys.argv[1:4])
