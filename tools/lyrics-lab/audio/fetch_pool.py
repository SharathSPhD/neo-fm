#!/usr/bin/env python3
"""Polite fetch of public neo-fm pool songs for scorer calibration. Public pages only: sitemap.xml, /t/<id> and /s/<publicId>.
The audio URL is the signed URL the public page itself serves in its <audio src>. No login, no admin or API routes.
Sequential, 1 s between requests, custom User-Agent, <=150 tracks stratified by language, stops at 2 GB.
python audio/fetch_pool.py [--max-tracks 150] [--max-gb 2] [--out data/audio]
Writes data/audio/*.mp3 (gitignored) and data/audio/manifest.jsonl."""
import argparse, collections, html, json, os, re, time, urllib.request, urllib.parse

UA = "neo-fm-lyrics-lab/0.1 (research calibration of an audio scorer; owner-authorised; sequential 1 rps)"
BASE = "https://www.neo-fm.com"; TOP = ["kn", "hi", "te", "ta", "mr"]
last = [0.0]

def get(url, binary=False):
    wait = 1.0 - (time.time() - last[0])
    if wait > 0: time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r: data = r.read()
    last[0] = time.time()
    return data if binary else data.decode("utf-8", "replace")

def parse_page(url, page):
    kind = "song" if "/s/" in url else "track"
    m = re.search(r'src="(https://[^"]+\.supabase\.co/storage/[^"]+)"', page)
    audio = html.unescape(m.group(1)) if m else None
    ld = re.search(r'<script type="application/ld\+json">(.*?)</script>', page, re.S)
    meta = json.loads(ld.group(1)) if ld else {}
    meta = meta[0] if isinstance(meta, list) and meta else meta
    lyrics = "\n".join(html.unescape(x).strip() for x in re.findall(r"<pre[^>]*>(.*?)</pre>", page, re.S)) if kind == "song" else None
    desc = re.search(r'<meta name="description" content="([^"]*)"', page)
    tags = re.findall(r">([A-Za-z][^<>|]{2,40} · [^<>]{2,40})<", page)  # e.g. "Hindustani · Hindi · 30s" on song pages
    inst = [t for t in re.findall(r">([a-z][a-z ,+]{6,80})<", page) if "," in t or "+" in t][:2]
    return {"kind": kind, "page_url": url, "language": meta.get("inLanguage"), "title": meta.get("name"), "duration": meta.get("duration"),
            "audio_url": audio, "audio_name": os.path.basename(urllib.parse.urlparse(audio).path) if audio else None,
            "lyrics": lyrics or None, "style_hint": tags[0].strip() if tags else None, "instruments": inst or None,
            "description": html.unescape(desc.group(1)) if desc else None, "fetched_at": time.time()}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-tracks", type=int, default=150); ap.add_argument("--max-gb", type=float, default=2.0); ap.add_argument("--out", default="data/audio")
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    locs = re.findall(r"<loc>([^<]+)</loc>", get(BASE + "/sitemap.xml"))
    pages = [u for u in locs if re.search(r"/(t|s)/[^/]+$", u)]
    print(f"sitemap: {len(pages)} song/track pages", flush=True)
    info = []
    for u in pages:
        try: p = parse_page(u, get(u))
        except Exception as e: print("page fail", u, repr(e)[:80]); continue
        if p["audio_url"]: info.append(p)
    print("pages with audio url:", len(info), collections.Counter(p["language"] for p in info), flush=True)
    # stratify: songs (which carry lyrics) first, then round-robin across kn/hi/te/ta/mr/others
    groups = collections.defaultdict(list)
    for p in sorted(info, key=lambda p: p["kind"] != "song"): groups[p["language"] if p["language"] in TOP else "others"].append(p)
    chosen = []
    while len(chosen) < a.max_tracks and any(groups.values()):
        for g in list(groups):
            if groups[g] and len(chosen) < a.max_tracks: chosen.append(groups[g].pop(0))
    total = 0; man = open(os.path.join(a.out, "manifest.jsonl"), "w", encoding="utf-8")
    for i, p in enumerate(chosen):
        fn = f"{i:03d}-{p['page_url'].rstrip('/').split('/')[-1]}.mp3"; dst = os.path.join(a.out, fn)
        try:
            if time.time() - p["fetched_at"] > 1800:  # signed URLs are short-lived: take a fresh one from the page
                p = {**parse_page(p["page_url"], get(p["page_url"])), "kind": p["kind"]}
            data = get(p["audio_url"], binary=True)
        except Exception as e: print("audio fail", p["page_url"], repr(e)[:80]); continue
        open(dst, "wb").write(data); total += len(data)
        row = {k: v for k, v in p.items() if k not in ("audio_url", "fetched_at")}  # signed URLs expire and carry tokens: not stored
        man.write(json.dumps({"id": p["page_url"].rstrip("/").split("/")[-1], "file": fn, "bytes": len(data), **row}, ensure_ascii=False) + "\n"); man.flush()
        if total > a.max_gb * 1e9: print("2 GB cap reached"); break
    print(f"downloaded {i + 1} files, {total / 1e6:.0f} MB, languages:", collections.Counter(p["language"] for p in chosen))

if __name__ == "__main__": main()
