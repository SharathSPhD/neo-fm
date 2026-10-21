#!/usr/bin/env python3
"""Western English public-domain song/verse corpus from Project Gutenberg (cleared by PG as US public domain; a pre-1929 first
publication is the working test, the author's death year is recorded when PG lists it). Songbooks, ballads, hymns, spirituals,
nursery and folk songs: structure and imagery references for the English lyric harness, never copied into user output.

Usage: harvest_gutenberg.py OUT.jsonl [--per-query 6]"""
import argparse, json, re, time, urllib.request, urllib.parse, hashlib

UA = {"User-Agent": "neo-fm-corpus/0.1 (sharath.ai.colab@gmail.com)"}
QUERIES = ["folk songs", "ballads", "hymns", "songs and ballads", "negro spirituals", "sea songs shanties", "cowboy songs", "lullabies nursery rhymes",
           "love songs", "lyrics poems songs", "songs of the people", "carols", "college songs", "american songs", "irish songs", "scottish songs"]

def get(url, t=40):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=t) as r: return r.read().decode("utf-8", "replace")
        except Exception: time.sleep(2 * (i + 1))
    return ""

def search(q, n):
    html = get("https://www.gutenberg.org/ebooks/search/?" + urllib.parse.urlencode({"query": q, "sort_order": "downloads"}))
    out = []
    for m in re.finditer(r'<li class="booklink">.*?href="/ebooks/(\d+)".*?<span class="title">(.*?)</span>.*?<span class="subtitle">(.*?)</span>', html, re.S):
        out.append((m.group(1), re.sub(r"<[^>]+>", "", m.group(2)).strip(), re.sub(r"<[^>]+>", "", m.group(3)).strip()))
    return out[:n]

def blocks(txt):
    a, b = txt.find("*** START"), txt.find("*** END")
    if a >= 0: txt = txt[txt.find("\n", a) + 1:]
    if b >= 0: txt = txt[:txt.find("*** END")]
    for blk in re.split(r"\n\s*\n\s*\n+", txt.replace("\r", "")):
        ls = [re.sub(r"\s+", " ", l).strip() for l in blk.split("\n") if l.strip()]
        if 8 <= len(ls) <= 48 and sum(len(l) for l in ls) / len(ls) < 55 and not any(re.search(r"gutenberg|copyright|chapter|\[Illustration", l, re.I) for l in ls):
            yield ls

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("out"); ap.add_argument("--per-query", type=int, default=6); a = ap.parse_args()
    seen_books, seen, n = set(), set(), 0
    with open(a.out, "w", encoding="utf-8") as fo:
        for q in QUERIES:
            for bid, title, author in search(q, a.per_query):
                if bid in seen_books: continue
                seen_books.add(bid); txt = get(f"https://www.gutenberg.org/cache/epub/{bid}/pg{bid}.txt", 90); time.sleep(1)
                k = 0
                for ls in blocks(txt):
                    text = "\n".join(ls); h = hashlib.sha1(text.encode()).hexdigest()
                    if h in seen: continue
                    seen.add(h); k += 1; n += 1
                    fo.write(json.dumps({"id": f"pg-en-{h[:10]}", "lang": "en", "source": f"gutenberg:{bid}", "book": title, "author": author, "query": q, "text": text,
                                         "n_lines": len(ls), "licence": "PG: US public domain; confirm author death <= 1964 for India before any training use"}, ensure_ascii=False) + "\n")
                print(q, bid, title[:50], k, flush=True)
    print("rows", n)

if __name__ == "__main__": main()
