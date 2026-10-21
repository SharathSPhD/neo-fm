#!/usr/bin/env python3
"""Licence-tiered music METADATA catalogue (no audio is downloaded or redistributed here).
  ia       Internet Archive audio: licenceurl CC0/CC-BY/CC-BY-SA/PD mark (tier A/B), CC-NC/ND (tier C eval-only), and India 78rpm <= 1965 (tier P: sound recording past India's 60-year term; composition rights separate)
  commons  Wikimedia Commons audio per instrument in instruments.json, with the file licence (reference clips for CLAP/embedding probes of 'is the veena actually there')
  saraga   CompMusic Saraga (Zenodo 4301737) record metadata: CC BY-NC-SA, eval only
Usage: music_catalogue.py ia|commons|saraga OUT.jsonl"""
import json, os, re, sys, time, urllib.request, urllib.parse
UA = {"User-Agent": "neo-fm-corpus/0.1 (sharath.ai.colab@gmail.com)"}
HERE = os.path.dirname(os.path.abspath(__file__))

def get(url, t=40):
    for i in range(4):
        try: return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=t))
        except Exception: time.sleep(3 * (i + 1))
    return {}

IA_TOPICS = {"carnatic": "carnatic OR veena OR mridangam OR thyagaraja OR tyagaraja", "hindustani": "hindustani OR sitar OR sarod OR tabla OR raga OR dhrupad",
             "bhajan_devotional": "bhajan OR kirtan OR devotional OR abhang OR dasara OR purandara", "kannada": "kannada OR bhavageete OR vachana OR haridasa",
             "hindi_film_vintage": "hindi film OR bollywood OR ghazal OR qawwali OR thumri", "tamil_telugu": "tamil OR telugu OR carnatic kriti OR annamacharya",
             "bengali_folk": "baul OR rabindra sangeet OR bengali folk", "indian_folk": "indian folk OR lavani OR bhangra OR garba OR folk songs india",
             "western_folk_blues": "blues OR gospel OR spirituals OR folk songs OR ragtime OR jazz 1920s", "western_classical_pd": "chamber music OR symphony OR sonata"}
LIC = {"A": ["publicdomain/zero", "publicdomain/mark", "licenses/by/", "licenses/by-sa/"], "C": ["by-nc", "by-nd"]}

def tier(lic):
    l = lic or ""
    if any(k in l for k in LIC["C"]): return "C"
    if "publicdomain" in l: return "A"
    if "licenses/by/" in l or "licenses/by-sa/" in l: return "B"
    return None

def ia(out):
    seen, n = set(), 0
    with open(out, "w", encoding="utf-8") as fo:
        for topic, terms in IA_TOPICS.items():
            for lic_q, label in (("licenseurl:(*creativecommons*) OR licenseurl:(*publicdomain*)", "licensed"),):
                q = f"mediatype:audio AND ({terms}) AND ({lic_q})"
                for page in (1, 2, 3):
                    r = get("https://archive.org/advancedsearch.php?" + urllib.parse.urlencode({"q": q, "fl[]": ["identifier", "title", "creator", "licenseurl", "date", "language", "downloads", "collection"], "rows": 100, "page": page, "output": "json", "sort[]": "downloads desc"}, doseq=True)).get("response", {})
                    for d in r.get("docs", []):
                        if d["identifier"] in seen or not tier(d.get("licenseurl")): continue
                        seen.add(d["identifier"]); n += 1
                        fo.write(json.dumps({"id": "ia:" + d["identifier"], "topic": topic, "tier": tier(d.get("licenseurl")), "title": d.get("title"), "creator": d.get("creator"), "date": d.get("date"),
                                             "language": d.get("language"), "licenceurl": d.get("licenseurl"), "downloads": d.get("downloads"), "url": "https://archive.org/details/" + d["identifier"]}, ensure_ascii=False) + "\n")
                    time.sleep(1)
            # India 78 rpm <= 1965: sound-recording term has lapsed in India; underlying composition/lyrics must still be cleared
            for page in (1, 2):
                q = f"collection:78rpm AND ({terms}) AND date:[1900-01-01 TO 1965-12-31]"
                r = get("https://archive.org/advancedsearch.php?" + urllib.parse.urlencode({"q": q, "fl[]": ["identifier", "title", "creator", "date", "language", "downloads"], "rows": 100, "page": page, "output": "json"}, doseq=True)).get("response", {})
                for d in r.get("docs", []):
                    if d["identifier"] in seen: continue
                    seen.add(d["identifier"]); n += 1
                    fo.write(json.dumps({"id": "ia:" + d["identifier"], "topic": topic, "tier": "P", "title": d.get("title"), "creator": d.get("creator"), "date": d.get("date"), "language": d.get("language"),
                                         "licenceurl": None, "note": "78rpm <=1965: recording term lapsed in India (60y); US term differs; composition rights not cleared", "url": "https://archive.org/details/" + d["identifier"]}, ensure_ascii=False) + "\n")
                time.sleep(1)
            print(topic, n, flush=True)
    print("rows", n)

def commons(out):
    inst = json.load(open(os.path.join(HERE, "instruments.json"))); n = 0
    with open(out, "w", encoding="utf-8") as fo:
        for fam, items in inst.items():
            if fam.startswith("_"): continue
            for it in items:
                r = get("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({"action": "query", "format": "json", "generator": "search", "gsrsearch": it["commons"] + " filetype:audio", "gsrnamespace": 6, "gsrlimit": 12,
                        "prop": "imageinfo", "iiprop": "url|extmetadata|size|mime", "iiextmetadatafilter": "LicenseShortName|Artist|Credit|UsageTerms"}))
                for p in (r.get("query", {}).get("pages", {}) or {}).values():
                    ii = (p.get("imageinfo") or [{}])[0]; md = ii.get("extmetadata", {}); lic = md.get("LicenseShortName", {}).get("value", "")
                    if not ii.get("url") or not re.search(r"CC0|CC BY|Public domain|PD", lic, re.I) or re.search(r"NC|ND", lic): continue
                    n += 1
                    fo.write(json.dumps({"id": "commons:" + p["title"], "family": fam, "instrument": it["name"], "query": it["commons"], "licence": lic, "mime": ii.get("mime"), "bytes": ii.get("size"), "url": ii["url"],
                                         "page": "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(p["title"].replace(" ", "_"))}, ensure_ascii=False) + "\n")
                time.sleep(0.7)
            print(fam, n, flush=True)
    print("rows", n)

def saraga(out):
    r = get("https://zenodo.org/api/records/4301737")
    md = r.get("metadata", {})
    with open(out, "w", encoding="utf-8") as fo:
        fo.write(json.dumps({"id": "zenodo:4301737", "title": md.get("title"), "licence": (md.get("license") or {}).get("id"), "doi": r.get("doi"), "files": [{"key": f["key"], "size": f["size"]} for f in r.get("files", [])],
                             "tier": "C", "note": "CC BY-NC-SA: evaluation/research only, never in shipped training"}, ensure_ascii=False) + "\n")
    print("saraga record written")

if __name__ == "__main__": {"ia": ia, "commons": commons, "saraga": saraga}[sys.argv[1]](sys.argv[2])
