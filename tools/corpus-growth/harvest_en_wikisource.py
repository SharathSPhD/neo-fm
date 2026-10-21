#!/usr/bin/env python3
"""English Wikisource song pages (folk songs, ballads, hymns, shanties, songs) via the API, one row per song with revision id.
Wikisource lists these as public domain by community judgement; keep page + rev for per-work review. Western English complement
to harvest_gutenberg.py (songbooks).  Usage: harvest_en_wikisource.py OUT.jsonl"""
import json, re, sys, time, urllib.request, urllib.parse, hashlib
import mwparserfromhell as mw
UA = {"User-Agent": "neo-fm-corpus/0.1 (sharath.ai.colab@gmail.com)"}
CATS = ["Category:Songs", "Category:Folk songs", "Category:Hymns", "Category:Ballads", "Category:Sea shanties", "Category:Spirituals", "Category:Carols", "Category:Lullabies", "Category:Nursery rhymes", "Category:Love songs", "Category:Work songs", "Category:Cowboy songs"]

def api(**p):
    p["format"] = "json"
    for i in range(4):
        try: return json.load(urllib.request.urlopen(urllib.request.Request("https://en.wikisource.org/w/api.php?" + urllib.parse.urlencode(p), headers=UA), timeout=40))
        except Exception: time.sleep(3 * (i + 1))
    return {}

def members(cat, depth=1):
    out, cont = [], {}
    while True:
        r = api(action="query", list="categorymembers", cmtitle=cat, cmlimit=500, **cont)
        for m in r.get("query", {}).get("categorymembers", []):
            if m["ns"] == 0: out.append(m["title"])
            elif m["ns"] == 14 and depth > 0: out += members(m["title"], depth - 1)
        if "continue" not in r: return out
        cont = r["continue"]

def clean(txt):
    code = mw.parse(txt)
    for t in code.filter_templates(recursive=False):
        try: code.remove(t)
        except Exception: pass
    s = code.strip_code(normalize=True, collapse=True)
    s = re.sub(r"</?poem[^>]*>|<br\s*/?>", "\n", s); s = re.sub(r"<[^>]+>|https?://\S+", "", s)
    return "\n".join(re.sub(r"\s+", " ", l).strip() for l in s.splitlines()).strip()

def main(out):
    titles = {}
    for c in CATS:
        for t in members(c): titles.setdefault(t, c)
    print("titles", len(titles), flush=True)
    ts, n, seen = list(titles), 0, set()
    with open(out, "w", encoding="utf-8") as fo:
        for i in range(0, len(ts), 40):
            r = api(action="query", prop="revisions", rvprop="content|ids", rvslots="main", titles="|".join(ts[i:i + 40]))
            for p in r.get("query", {}).get("pages", {}).values():
                rev = (p.get("revisions") or [{}])[0]; raw = rev.get("slots", {}).get("main", {}).get("*", "")
                if not raw or "copyright" in raw.lower()[:400] and "{{" in raw[:200] and "pd" not in raw.lower()[:400]: continue
                body = clean(raw); ls = [l for l in body.split("\n") if l.strip()]
                if not (6 <= len(ls) <= 80) or sum(len(l) for l in ls) / len(ls) > 60: continue
                h = hashlib.sha1(body.encode()).hexdigest()
                if h in seen: continue
                seen.add(h); n += 1
                fo.write(json.dumps({"id": f"wse-en-{h[:10]}", "lang": "en", "source": "en.wikisource.org", "work": p["title"], "category": titles[p["title"]], "rev": rev.get("revid"),
                                     "text": body, "n_lines": len(ls), "licence": "Wikisource-hosted, community-judged public domain; wrapper CC BY-SA 4.0; verify per work"}, ensure_ascii=False) + "\n")
            time.sleep(0.5)
    print("rows", n)

if __name__ == "__main__": main(sys.argv[1])
