#!/usr/bin/env python3
"""Cinema/album song metadata (title, lyricist, composer, year, language) from Wikidata (CC0). Facts only, no lyrics.
Usage: wikidata_songs.py OUT.jsonl"""
import sys, json, urllib.request, urllib.parse
LANGS = {"kn": "Q33673", "hi": "Q11051", "en": "Q1860", "ta": "Q5885", "te": "Q8097", "ml": "Q36236", "mr": "Q1571", "bn": "Q9610", "pa": "Q58635", "gu": "Q5137"}
Q = """SELECT ?s ?sLabel ?lyr ?lyrLabel ?comp ?compLabel ?year ?genreLabel WHERE {{
 ?s wdt:P31/wdt:P279* wd:Q7366; wdt:P407 wd:{lang}.
 OPTIONAL {{?s wdt:P676 ?lyr}} OPTIONAL {{?s wdt:P86 ?comp}} OPTIONAL {{?s wdt:P577 ?d. BIND(YEAR(?d) AS ?year)}} OPTIONAL {{?s wdt:P136 ?genre}}
 SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,hi,kn". }} }} LIMIT 20000"""
def main(out):
    n = 0
    with open(out, "w", encoding="utf-8") as fo:
        for lang, q in LANGS.items():
            url = "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(Q.format(lang=q))
            try: rows = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "neo-fm-corpus/1.0"}), timeout=90))["results"]["bindings"]
            except Exception as e: print(lang, "failed", e); continue
            for b in rows:
                g = lambda k: b.get(k, {}).get("value")
                fo.write(json.dumps({"lang": lang, "qid": g("s").rsplit("/", 1)[-1], "title": g("sLabel"), "lyricist": g("lyrLabel"), "composer": g("compLabel"), "year": g("year"), "genre": g("genreLabel"), "license": "CC0 (Wikidata)"}, ensure_ascii=False) + "\n"); n += 1
            print(lang, len(rows), flush=True)
    print("total", n)
if __name__ == "__main__": main(sys.argv[1])
