#!/usr/bin/env python3
"""Structured style-cue catalog for the render harness: raga / tala / form / instrument facts (no audio, no lyrics).
  saraga       per-track JSON read by HTTP range from the Zenodo zips (CC BY-NC-SA 4.0: research/eval only, facts feed a prompt-cue table, no redistribution of the dataset)
  musicbrainz  CC0 core data: works/recordings by language (kan, hin) with tags
Usage: style_catalog.py OUT.json"""
import io, sys, json, time, zipfile, urllib.request, urllib.parse, collections
UA = {"User-Agent": "neo-fm-corpus/0.1 (sharath.ai.colab@gmail.com)"}

class HttpFile(io.RawIOBase):
    def __init__(s, u):
        s.u, s.p = u, 0; s.n = int(urllib.request.urlopen(urllib.request.Request(u, method="HEAD", headers=UA)).headers["Content-Length"])
    def seekable(s): return True
    def readable(s): return True
    def tell(s): return s.p
    def seek(s, o, w=0): s.p = o if w == 0 else s.p + o if w == 1 else s.n + o; return s.p
    def readinto(s, b):
        k = min(len(b), s.n - s.p)
        if k <= 0: return 0
        d = urllib.request.urlopen(urllib.request.Request(s.u, headers={**UA, "Range": f"bytes={s.p}-{s.p + k - 1}"}), timeout=60).read(); s.p += len(d); b[:len(d)] = d; return len(d)

def saraga():
    rows = []
    for trad in ("hindustani", "carnatic"):
        z = zipfile.ZipFile(io.BufferedReader(HttpFile(f"https://zenodo.org/records/4301737/files/saraga1.5_{trad}.zip?download=1"), 65536))
        for n in z.namelist():
            if not n.endswith(".json") or "__MACOSX" in n or n.rsplit("/", 1)[-1].startswith("._"): continue
            try: d = json.loads(z.read(n))
            except Exception: continue
            if not isinstance(d, dict) or "title" not in d: continue
            nm = lambda k, f="common_name": [x.get(f) or x.get("name") for x in d.get(k, [])]
            rows.append({"tradition": trad, "title": d["title"], "minutes": round((d.get("length") or 0) / 60000, 1), "ragas": nm("raags") or nm("raaga"), "talas": nm("taals") or nm("taala"),
                         "layas": nm("layas"), "forms": nm("forms") or nm("form"), "instruments": sorted({a["instrument"]["name"] for a in d.get("artists", []) if a.get("instrument")}),
                         "works": [w["title"] for w in d.get("works", [])]})
        print(trad, len(rows), flush=True)
    return rows

def musicbrainz(lang, n=300):
    out = []
    for off in range(0, n, 100):
        u = "https://musicbrainz.org/ws/2/work?" + urllib.parse.urlencode({"query": f"lang:{lang}", "limit": 100, "offset": off, "fmt": "json"})
        try: r = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40))
        except Exception as e: print("mb", lang, e); break
        for w in r.get("works", []):
            out.append({"title": w.get("title"), "type": w.get("type"), "mbid": w["id"]})
        time.sleep(1.2)
    return out

def main(out):
    s = saraga(); cnt = lambda k: collections.Counter(x for r in s for x in r[k]).most_common()
    cat = {"_licence": {"saraga": "CC BY-NC-SA 4.0 (Zenodo 4301737): non-commercial. Used only to derive a facts table (raga/tala/form/instrument co-occurrence); nothing from the dataset is shipped or trained on. Confirm with a lawyer before shipping the derived cue table.",
                        "musicbrainz": "CC0 core data (works/recordings/tags); tags are CC BY-NC-SA, not used."},
           "counts": {k: cnt(k) for k in ("ragas", "talas", "forms", "instruments", "layas")}, "tracks": s,
           "musicbrainz": {"kn": musicbrainz("kan"), "hi": musicbrainz("hin")}}
    json.dump(cat, open(out, "w"), ensure_ascii=False, indent=1)
    print({k: len(v) for k, v in cat["counts"].items()}, {k: len(v) for k, v in cat["musicbrainz"].items()})

if __name__ == "__main__": main(sys.argv[1])
