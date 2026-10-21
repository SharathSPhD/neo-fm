#!/usr/bin/env python3
"""Pass 1b: proofread Page namespace (ns 104) verse pages, joined to their Index (ns 106) record for Author/Year/Title.
Most Indic Wikisource poetry lives here (scanned books), not in the main namespace. Output rows carry book, author, year, source
so pass 2 can gate on a curated death-year allowlist. Pages with legacy-font mojibake (low target-script ratio) are dropped.

Usage: wikisource_pages.py DUMP.xml.bz2 LANG OUT.jsonl"""
import bz2, sys, re, json, hashlib, xml.etree.ElementTree as ET
import mwparserfromhell as mw

SCRIPT = {"kn": "ಀ-೿", "ta": "஀-௿", "te": "ఀ-౿", "hi": "ऀ-ॿ", "mr": "ऀ-ॿ",
          "bn": "ঀ-৿", "ml": "ഀ-ൿ", "gu": "઀-૿", "pa": "਀-੿"}

def clean(txt):
    txt = re.sub(r"<noinclude>.*?</noinclude>", "", txt, flags=re.S)
    code = mw.parse(txt)
    for t in code.filter_templates(recursive=False):
        try: code.remove(t)
        except Exception: pass
    s = code.strip_code(normalize=True, collapse=True)
    s = re.sub(r"</?poem[^>]*>|<br\s*/?>|</br>", "\n", s); s = re.sub(r"<[^>]+>|https?://\S+", "", s)
    return "\n".join(l for l in (re.sub(r"\s+", " ", l).strip(" :") for l in s.splitlines()) if l)

def param(txt, k):
    m = re.search(r"\|\s*" + k + r"\s*=\s*([^\n|]*)", txt); return re.sub(r"\[\[|\]\]", "", m.group(1)).strip() if m else ""

def main(dump, lang, out):
    rx = re.compile(f"[{SCRIPT[lang]}]"); idx, rows_by_book = {}, {}
    with bz2.open(dump, "rb") as f:
        for _, el in ET.iterparse(f):
            if not el.tag.endswith("}page"): continue
            ns = el.find("{*}ns").text; title = el.findtext("{*}title") or ""; txt = el.findtext("{*}revision/{*}text") or ""; rev = el.findtext("{*}revision/{*}id")
            el.clear()
            if ns in ("106", "252") and "Proofreadpage_index" in txt:
                idx[title.split(":", 1)[1]] = {"title": param(txt, "Title"), "author": param(txt, "Author"), "year": param(txt, "Year"), "source": param(txt, "Source")[:120]}
            elif ns in ("104", "250") and len(txt) > 60:
                book = title.split(":", 1)[1].rsplit("/", 1)[0]
                body = clean(txt); ls = [l for l in body.split("\n") if l]
                if not (3 <= len(ls) <= 60): continue
                letters = [c for c in body if c.isalpha()]
                if not letters or len(rx.findall(body)) / len(letters) < 0.85: continue
                if sum(len(l) for l in ls) / len(ls) > 60: continue
                rows_by_book.setdefault(book, []).append((title, rev, body, len(ls)))
    n = 0
    with open(out, "w", encoding="utf-8") as fo:
        for book, pages in rows_by_book.items():
            meta = idx.get(book, {})
            if len(pages) < 3: continue  # isolated verse-like pages are usually tables/lists; real poetry books have runs
            for title, rev, body, nl in pages:
                n += 1
                fo.write(json.dumps({"id": f"wsp-{lang}-{hashlib.sha1(body.encode()).hexdigest()[:10]}", "lang": lang, "book": book, "title": meta.get("title", ""),
                         "author": meta.get("author", ""), "year": meta.get("year", ""), "page": title, "rev": rev, "text": body, "n_lines": nl, "src": "page-ns"}, ensure_ascii=False) + "\n")
    print(f"{lang}: books={len(rows_by_book)} indexed={len(idx)} page_rows={n}")

if __name__ == "__main__": main(*sys.argv[1:4])
