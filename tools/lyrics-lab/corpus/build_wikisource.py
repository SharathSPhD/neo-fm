#!/usr/bin/env python3
"""Build a verse-like text corpus from Wikisource dumps (kn, ta, te, hi, mr).

Wikisource hosts transcribed works its communities judge public domain, wrapped in a CC BY-SA wiki licence. The work-level
status is NOT verified here, so every row carries source + title for later per-work review and the manifest says so.
Rules: main namespace only, drop pages that mention copyright/permission templates, drop non-verse prose, dedupe.

Usage: build_wikisource.py DUMP.xml.bz2 LANG OUT.jsonl
"""
import bz2, sys, re, json, hashlib, xml.etree.ElementTree as ET
import mwparserfromhell as mw

BAD_TMPL = re.compile(r"copyright|permission|cc-by|cc by|gfdl|fairuse|non-?free|licen[cs]e|ಹಕ್ಕುಸ್ವಾಮ್ಯ|कॉपीराइट|பதிப்புரிமை|కాపీరైట్", re.I)
SKIP_TITLE = re.compile(r"^(मुखपृष्ठ|Main Page|ಮುಖ್ಯ|முதற்|ముఖ్య|साचा|Template|Help)", re.I)

def clean(wikitext: str) -> str:
    code = mw.parse(wikitext)
    for t in code.filter_templates(): 
        try: code.remove(t)
        except Exception: pass
    text = code.strip_code(normalize=True, collapse=True)
    text = re.sub(r"</?poem[^>]*>", "", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"https?://\S+", "", text)
    lines = [re.sub(r"\s+", " ", l).strip() for l in text.splitlines()]
    return "\n".join(l for l in lines if l)

def verse_like(text: str) -> bool:
    ls = [l for l in text.split("\n") if l]
    if len(ls) < 4: return False
    lens = sorted(len(l) for l in ls)
    med = lens[len(lens) // 2]
    short = sum(1 for l in ls if 8 <= len(l) <= 90) / len(ls)
    return med <= 70 and short >= 0.7

def main(dump: str, lang: str, out: str):
    seen = set(); n_pages = kept = 0
    with open(out, "w", encoding="utf-8") as fo:
        for _, el in ET.iterparse(bz2.open(dump), events=("end",)):
            if not el.tag.endswith("}page"): continue
            n_pages += 1
            ns = el.find("{*}ns").text
            title = el.findtext("{*}title") or ""
            txt = el.findtext("{*}revision/{*}text") or ""
            el.clear()
            if ns != "0" or el.find("{*}redirect") is not None or SKIP_TITLE.match(title) or len(txt) < 80: continue
            if BAD_TMPL.search(" ".join(str(t.name) for t in mw.parse(txt).filter_templates())): continue
            body = clean(txt)
            if not verse_like(body): continue
            h = hashlib.sha1(body.encode()).hexdigest()
            if h in seen: continue
            seen.add(h); kept += 1
            fo.write(json.dumps({"id": f"wikisource-{lang}-{h[:10]}", "lang": lang, "source": f"{lang}.wikisource.org", "title": title,
                                 "text": body, "n_lines": body.count("\n") + 1,
                                 "licence_note": "Wikisource wrapper CC BY-SA 4.0; underlying work PD per community, unverified per work"}, ensure_ascii=False) + "\n")
    print(f"{lang}: pages={n_pages} kept={kept}")

if __name__ == "__main__": main(*sys.argv[1:4])
