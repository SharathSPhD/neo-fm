#!/usr/bin/env python3
"""Download OCR text (djvu.txt) of selected old Kannada kirtana / folk-song books from Internet Archive (DLI scans), split into
song-form units, drop OCR noise by script share, score with lyricmetrics. Pre-modern dasa compositions are PD; folk songs are oral tradition;
the 1920s-30s editions are tier B (edition / collector rights unverified). Usage: ia_kn_texts.py OUT.jsonl"""
import sys, os, re, json, urllib.request, urllib.parse
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lyrics-lab", "bench"))
from lyricmetrics import score
UA = {"User-Agent": "neo-fm-corpus/0.1 (sharath.ai.colab@gmail.com)"}
BOOKS = {  # id: (author/genre, year)
    "dli.osmania.3811": ("Purandara Dasa kirtane 5", 1930), "dli.osmania.3339": ("Purandara Dasa kirtane 4", 1929),
    "dli.osmania.3335": ("Jagannatha Dasa kirtane 1", 1926), "dli.osmania.3655": ("Vadiraja kirtane 1", 1925),
    "PurandaraDaasaraPadagalu": ("Purandara Dasa padagalu", None), "in.ernet.dli.2015.363796": ("Aratiya haadu (folk)", 1931),
    "dli.ernet.554315": ("Janapada sharana kavyagalu", None), "DLIKannadaJanapada": ("Janapada", None), "janapadapandyasa0000unse": ("Janapada padya sangraha", None),
}
KN = re.compile(r"[ಀ-೿]")

def fetch(i):
    md = json.load(urllib.request.urlopen(urllib.request.Request(f"https://archive.org/metadata/{i}", headers=UA), timeout=60))
    f = next((x["name"] for x in md.get("files", []) if x["name"].endswith("_djvu.txt")), None)
    if not f: return ""
    return urllib.request.urlopen(urllib.request.Request(f"https://archive.org/download/{i}/{urllib.parse.quote(f)}", headers=UA), timeout=120).read().decode("utf-8", "ignore")

def units(txt):
    for blk in re.split(r"\n\s*\n", txt):
        ls = [re.sub(r"\s+", " ", l).strip() for l in blk.split("\n") if l.strip()]
        if not 4 <= len(ls) <= 40: continue
        ks = sum(len(KN.findall(l)) for l in ls); allc = sum(len(re.sub(r"\s", "", l)) for l in ls)
        if allc == 0 or ks / allc < 0.85 or sum(map(len, ls)) / len(ls) > 60: continue
        yield "\n".join(ls)

def main(out):
    n = 0
    with open(out, "w", encoding="utf-8") as fo:
        for i, (name, year) in BOOKS.items():
            try: txt = fetch(i)
            except Exception as e: print(i, "fail", e); continue
            k = 0
            for u in units(txt):
                d = score(u, "kn").get("det") or 0
                fo.write(json.dumps({"id": f"iakn-{i}-{k}", "lang": "kn", "source": f"archive.org/details/{i}", "work": name, "year": year, "text": u, "det": d, "tier": "B",
                                     "license": "PD-era composition/oral tradition; scan edition rights unverified"}, ensure_ascii=False) + "\n"); k += 1; n += 1
            print(i, len(txt), "units", k, flush=True)
    print("total", n)
if __name__ == "__main__": main(sys.argv[1])
