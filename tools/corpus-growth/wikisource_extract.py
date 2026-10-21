#!/usr/bin/env python3
"""Pass 1 of the public-domain lyric/verse harvest: stream a Wikisource dump and write every verse-like main-namespace page
with its header-template parameters (author, year, ...), so authors can be gated against a curated death-year allowlist
(pd_authors.json) in pass 2 (wikisource_filter.py). No text leaves this file without provenance.

Usage: wikisource_extract.py DUMP.xml.bz2 LANG OUT.jsonl"""
import bz2, sys, re, json, hashlib, xml.etree.ElementTree as ET
import mwparserfromhell as mw

SKIP_TITLE = re.compile(r"^(मुखपृष्ठ|Main Page|ಮುಖ್ಯ|முதற்|ముఖ్య|साचा|Template|Help|প্রধান)", re.I)
NONFREE = re.compile(r"copyright|permission|fairuse|non-?free|licen[cs]e|ಹಕ್ಕುಸ್ವಾಮ್ಯ|कॉपीराइट|பதிப்புரிமை|కాపీరైట్", re.I)

def clean(wikitext):
    code = mw.parse(wikitext)
    for t in code.filter_templates(recursive=False):
        try: code.remove(t)
        except Exception: pass
    text = code.strip_code(normalize=True, collapse=True)
    text = re.sub(r"</?poem[^>]*>|<br\s*/?>|</br>", "\n", text)
    text = re.sub(r"<[^>]+>|https?://\S+", "", text)
    lines = [re.sub(r"\s+", " ", l).strip(" :") for l in text.splitlines()]
    return "\n".join(l for l in lines if l or True).strip()

def verse_like(text):
    ls = [l for l in text.split("\n") if l.strip()]
    if len(ls) < 4 or len(ls) > 400: return False
    avg = sum(len(l) for l in ls) / len(ls)
    return avg < 70 and sum(len(l) < 90 for l in ls) / len(ls) > 0.9

def main(dump, lang, out):
    seen, kept, pages = set(), 0, 0
    with bz2.open(dump, "rb") as f, open(out, "w", encoding="utf-8") as fo:
        for _, el in ET.iterparse(f):
            if not el.tag.endswith("}page"): continue
            pages += 1
            ns = el.find("{*}ns").text; title = el.findtext("{*}title") or ""
            txt = el.findtext("{*}revision/{*}text") or ""; rid = el.findtext("{*}revision/{*}id")
            redirect = el.find("{*}redirect") is not None
            el.clear()
            if ns != "0" or redirect or SKIP_TITLE.match(title) or len(txt) < 80: continue
            code = mw.parse(txt); tmpls = code.filter_templates(recursive=False)
            if NONFREE.search(" ".join(str(t.name) for t in tmpls)): continue
            body = clean(txt)
            if not verse_like(body): continue
            h = hashlib.sha1(body.encode()).hexdigest()
            if h in seen: continue
            seen.add(h); kept += 1
            hdr = [{"name": str(t.name).strip()[:40], "params": {str(p.name).strip()[:30]: str(p.value).strip()[:80] for p in t.params}} for t in tmpls[:4]]
            fo.write(json.dumps({"id": f"ws-{lang}-{h[:10]}", "lang": lang, "title": title, "rev": rid, "hdr": hdr, "text": body,
                                 "n_lines": body.count("\n") + 1}, ensure_ascii=False) + "\n")
    print(f"{lang}: pages={pages} verse_like={kept}")

if __name__ == "__main__": main(*sys.argv[1:4])
