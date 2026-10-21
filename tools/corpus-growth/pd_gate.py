#!/usr/bin/env python3
"""Pass 2: gate Wikisource verse rows on the PD-author allowlist and emit the licence-tiered lyric-reference corpus.
Tier A: author died <= 1964 (or medieval/ancient), no edition flag. Tier B: PD text, modern edition may carry its own right (edition_review).
Rows from authors not on the list are dropped, not kept 'unknown'. Pages that look like editorial matter are removed.

Usage: pd_gate.py LANG WS_MAIN.jsonl WS_PAGES.jsonl OUT.jsonl"""
import json, re, sys, os, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
EDITORIAL = re.compile(r"सम्पादक|संपादक|प्रकाशक|मुद्रक|प्रथम संस्करण|मूल्य|सूचीपत्र|अनुक्रमणिका|ಸಂಪಾದಕ|ಪ್ರಕಾಶ|ಮುನ್ನುಡಿ|ಪರಿವಿಡಿ|ಮುದ್ರಕ|विषय-सूची|ISBN|©|Copyright|संस्करण", re.I)

DIG = str.maketrans("०१२३४५६७८९೦೧೨೩೪೫೬೭೮೯౦౧౨౩౪౫౬౭౮౯", "0123456789" * 3)

def tidy(text):
    """Drop page numbers and running heads; keep the verse lines."""
    ls = [l for l in text.split("\n") if l.strip()]
    ls = [l for l in ls if not re.fullmatch(r"[\d\s().*|\-–—]+", l.translate(DIG)) and "|" not in l]
    return "\n".join(ls)

def verse_shape(text):
    ls = text.split("\n")
    if len(ls) < 4: return False
    lens = [len(l) for l in ls]; avg = sum(lens) / len(lens)
    sd = (sum((x - avg) ** 2 for x in lens) / len(lens)) ** 0.5
    return avg <= 42 and sd / avg < 0.55  # prose pages wrap near a fixed 45-60 column width

def main(lang, main_f, pages_f, out):
    cfg = [c for c in json.load(open(os.path.join(HERE, "pd_authors.json"))).get(lang, []) if not c.get("exclude")]
    rx = [(re.compile(c["match"]), c) for c in cfg]
    stats, n, seen = {}, 0, set()
    with open(out, "w", encoding="utf-8") as fo:
        for path, kind in ((main_f, "main"), (pages_f, "page")):
            if not path or not os.path.exists(path): continue
            for line in open(path, encoding="utf-8"):
                r = json.loads(line)
                if kind == "main":  # header-template author fields
                    hv = " ".join(v for h in r.get("hdr", [])[:2] for k, v in h["params"].items() if any(s in k.lower() for s in ("author", "लेख", "रचय", "रचन", "ಲೇಖ", "ಕರ್ತೃ", "साहित्य", "కర్త", "రచ", "ஆசிரிய", "കർത്താ", "કર્તા")))
                    hv += " " + " ".join(h["name"] for h in r.get("hdr", [])[:3]); meta_s = hv + " " + r["title"]; book = r["title"]
                else:
                    meta_s = f'{r["author"]} {r["title"]} {r["book"]}'; book = r["title"] or r["book"]
                hit = next((c for p, c in rx if p.search(meta_s)), None)
                if not hit: continue
                r["text"] = tidy(r["text"]); r["n_lines"] = r["text"].count("\n") + 1
                if EDITORIAL.search(r["text"]) or not verse_shape(r["text"]): continue
                h = hashlib.sha1(r["text"].encode()).hexdigest()
                if h in seen: continue
                seen.add(h); n += 1
                tier = "B" if hit.get("edition_review") else "A"
                stats[(hit["author"], tier)] = stats.get((hit["author"], tier), 0) + 1
                fo.write(json.dumps({"id": r["id"], "lang": lang, "author": hit["author"], "died": hit.get("died"), "era": hit.get("era"), "tier": tier,
                                     "work": book, "source": f"{lang}.wikisource.org", "page": r.get("page") or r["title"], "rev": r.get("rev"),
                                     "text": r["text"], "n_lines": r["n_lines"],
                                     "licence": "public-domain text (author died <= 1964 or pre-modern); Wikisource wrapper CC BY-SA 4.0" + ("; modern edition may be in copyright, review before training" if tier == "B" else "")},
                                    ensure_ascii=False) + "\n")
    print(lang, "rows", n)
    for (a, t), c in sorted(stats.items(), key=lambda x: -x[1])[:25]: print(f"  {c:6d} {t} {a}")

if __name__ == "__main__": main(*sys.argv[1:5])
