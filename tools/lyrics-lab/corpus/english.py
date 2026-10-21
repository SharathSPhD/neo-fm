#!/usr/bin/env python3
"""English refs corpus from public-domain song/verse collections (stdlib only, no spend).
  extract  --raw DIR              split Project Gutenberg texts into song candidates -> english/candidates.jsonl
  build    --exemplars-out F --playbook-out F [--per-style 8]   free metrics -> english/corpus.jsonl, `en` exemplars + notes
Sources are PD in the US (authors dead long before 1929 or anonymous folk; Gutenberg editions). Provenance is kept per row.
Copyrighted lyrics are never ingested. Store: $CORPUS_DIR_EN (default $LAB/corpus-en)."""
import argparse, hashlib, json, os, re, collections

LAB = os.environ.get("LAB_DIR", "/mnt/project-files/lyrics-lab")
STORE = os.environ.get("CORPUS_DIR_EN", f"{LAB}/corpus-en")

# Gutenberg id -> (source label, author/era, style family the verse suits, skip-through predicate keyword)
SOURCES = {
    "21300": ("Cowboy songs, and other frontier ballads (Lomax, 1916)", "anonymous folk, collected 1910s", "english-country"),
    "21723": ("Songs of the cattle trail and cow camp (Lomax, 1919)", "anonymous folk and Lomax-era poets", "english-country"),
    "45240": ("Frontier Ballads (Hanson, 1910)", "Hanson 1910 and anonymous frontier verse", "english-country"),
    "54211": ("American War Ballads and Lyrics vol 2 (Eggleston, 1889)", "various 19th-century poets, all d. before 1929", "english-rock"),
    "649": ("Ancient Poems, Ballads and Songs of the Peasantry of England (Bell, 1857)", "anonymous English folk", "english-indie-folk"),
    "27129": ("Lyrics from the Song-Books of the Elizabethan Age (Bullen, 1891)", "Dowland, Campion, Byrd et al, d. before 1650", "english-indie-folk"),
    "1279": ("Poems and Songs of Robert Burns", "Robert Burns d. 1796", "english-indie-folk"),
}
BAD = re.compile(r"\b(nigger|nigga|coon|darky|darkey|chink|injun|redskin|squaw|gook|wop|dago|kike|spic|hell-bound|whore|bastard)\b", re.I)
DIALECT = set("wi frae gae gie auld ae bonie bonnie tae hae ilka kirk laddie lassie lass canna dinna cannie ain nae wad maun tho' o' thae sae jo dochter thir fu' sma' braw brae burn ben'".split())
ARCH = set("thee thou thy thine thyself hath doth dost art ye ere o'er e'er ne'er 'tis 'twas 'twere oft yon yonder wilt shalt wherefore whence hence amongst whilst".split())

def sha(t): return hashlib.sha256(re.sub(r"\s+", " ", t).strip().encode()).hexdigest()[:16]
def body(raw):
    m = re.search(r"\*\*\* START OF.*?\*\*\*", raw, re.S); e = raw.rfind("*** END OF")
    return raw[m.end():e if e > 0 else None] if m else raw

def songs_in(text):
    """A song = >=3 consecutive stanzas of 2-9 short lines, headed by the short title line(s) before it."""
    paras = [p for p in re.split(r"\n\s*\n", text.replace("\r", ""))]
    def verse(p):
        ls = [l for l in p.split("\n") if l.strip()]
        return 2 <= len(ls) <= 9 and all(len(l.rstrip()) <= 62 for l in ls) and not any(re.search(r"\.{4,}|\d+\s*$", l) and len(l) > 40 for l in ls)
    i, out = 0, []
    while i < len(paras):
        if verse(paras[i]):
            j = i
            while j < len(paras) and verse(paras[j]): j += 1
            if j - i >= 3:
                title = ""
                if i > 0:
                    cand = [l.strip() for l in paras[i - 1].split("\n") if l.strip()]
                    if cand and len(cand) <= 2 and all(len(l) <= 60 for l in cand) and not verse(paras[i - 1]) or (cand and len(cand) == 1 and len(cand[0]) <= 60):
                        title = re.sub(r"[_\[\]\d]", "", " ".join(cand)).strip(" .:—-")
                out.append((title, [[l.strip() for l in paras[k].split("\n") if l.strip()] for k in range(i, j)]))
            i = j
        else: i += 1
    return out

def last_word(l):
    w = re.findall(r"[a-z']+", l.lower()); return w[-1] if w else ""
def rhyme_key(w):
    m = re.search(r"[aeiouy]+[^aeiouy]*$", w); return m.group(0) if m else w
def syl(l): return sum(max(1, len(re.findall(r"[aeiouy]+", w))) for w in re.findall(r"[a-z']+", l.lower()))

def metrics(stanzas):
    lines = [l for s in stanzas for l in s]
    n = len(lines)
    if n == 0: return None
    lens = [syl(l) for l in lines]
    mean = sum(lens) / n; sd = (sum((x - mean) ** 2 for x in lens) / n) ** .5
    keys = [rhyme_key(last_word(l)) for l in lines]
    paired = 0
    for s in stanzas:
        ks = [rhyme_key(last_word(l)) for l in s]
        paired += sum(1 for a in range(len(ks)) if any(ks[a] == ks[b] for b in range(len(ks)) if b != a))
    rhyme = paired / n
    words = re.findall(r"[a-z']+", " ".join(lines).lower())
    arch = sum(w in ARCH for w in words) / max(1, len(words))
    dia = sum(w in DIALECT for w in words) / max(1, len(words))
    uniq = len(set(words)) / max(1, len(words))
    norm = ["|".join(re.sub(r"[^a-z ]", "", l.lower()) for l in s) for s in stanzas]
    refrain = len(norm) - len(set(norm))
    return {"lines": n, "stanzas": len(stanzas), "syl_mean": round(mean, 1), "syl_sd": round(sd, 2), "rhyme": round(rhyme, 2), "archaic": round(arch, 3), "dialect": round(dia, 3), "type_token": round(uniq, 2), "repeat_stanzas": refrain}

def score(m):
    """0-5 from free proxies: singable length, regular line length, rhyme, plain modern-ish diction, some repetition but not a loop."""
    if m["dialect"] > 0.02 or m["archaic"] > 0.05: return 0.0
    s = 0.0
    s += 1.0 if 12 <= m["lines"] <= 40 else 0.5 if 8 <= m["lines"] <= 56 else 0
    s += 1.0 if m["syl_sd"] <= 1.8 else 0.5 if m["syl_sd"] <= 2.6 else 0
    s += 1.0 if m["rhyme"] >= 0.7 else 0.5 if m["rhyme"] >= 0.45 else 0
    s += 1.0 if m["archaic"] <= 0.012 else 0.5 if m["archaic"] <= 0.03 else 0
    s += 0.5 if 0.45 <= m["type_token"] <= 0.85 else 0
    s += 0.5 if m["repeat_stanzas"] >= 1 else 0.25
    return round(s, 2)

def tagged(stanzas, cap=40):
    norm = ["|".join(re.sub(r"[^a-z ]", "", l.lower()) for l in s) for s in stanzas]
    rep = {n for n, c in collections.Counter(norm).items() if c > 1}
    out, v, lines = [], 0, 0
    for s, n in zip(stanzas, norm):
        if lines + len(s) > cap: break
        if n in rep: tag = "[Chorus]"
        else: v += 1; tag = f"[Verse {v}]"
        out.append(tag + "\n" + "\n".join(s)); lines += len(s)
    return "\n\n".join(out)

def brief_of(title, style, first):
    nice = re.sub(r"\b(\w)(\w*)'S\b", lambda m: m.group(1) + m.group(2) + "'s", title.title()) if title.isupper() or not title else title
    kind = {"english-country": "A country ballad", "english-rock": "A rousing song", "english-indie-folk": "A folk song"}.get(style, "A song")
    return f"{kind} called {nice}" if nice else f"{kind} that begins: {first.rstrip(',;:.')}"

def cmd_extract(a):
    rows, seen = [], set()
    for f in sorted(os.listdir(a.raw)):
        gid = f.removeprefix("pg").removesuffix(".txt")
        if gid not in SOURCES: continue
        src, auth, style = SOURCES[gid]
        for title, st in songs_in(body(open(os.path.join(a.raw, f), encoding="utf-8", errors="replace").read())):
            text = "\n\n".join("\n".join(s) for s in st)
            if BAD.search(text) or sha(text) in seen: continue
            seen.add(sha(text))
            rows.append({"id": f"en-{sha(text)[:10]}", "lang": "en", "style": style, "title": title, "stanzas": st, "provenance": {"source": "gutenberg", "gutenberg_id": gid, "collection": src, "authorship": auth, "licence": "public domain (US)"}})
    os.makedirs(STORE, exist_ok=True)
    with open(f"{STORE}/candidates.jsonl", "w", encoding="utf-8") as fh:
        for r in rows: fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    by = collections.Counter(r["provenance"]["gutenberg_id"] for r in rows)
    print("candidates", len(rows), dict(by))

def title_ok(t):
    return bool(re.match(r"[A-Z][A-Za-z' ,?!.-]{2,48}$", t.strip("“” ")) ) and not re.match(r"(by|from|the song of|part|chorus|song|vivamus)\b", t.strip("“” "), re.I) and "fragment" not in t.lower()

def cmd_build(a):
    rows = [json.loads(l) for l in open(f"{STORE}/candidates.jsonl", encoding="utf-8")]
    out = []
    for r in rows:
        m = metrics(r["stanzas"])
        if not m: continue
        r["metrics"], r["score"] = m, score(m)
        r["text"] = tagged(r["stanzas"])
        out.append(r)
    with open(f"{STORE}/corpus.jsonl", "w", encoding="utf-8") as fh:
        for r in out: fh.write(json.dumps({k: v for k, v in r.items() if k != "stanzas"}, ensure_ascii=False) + "\n")
    print("scored", len(out), "mean", round(sum(r["score"] for r in out) / max(1, len(out)), 2))
    ex, per_src = [], collections.Counter()
    for style in sorted({r["style"] for r in out}):
        pool = sorted([r for r in out if r["style"] == style and r["score"] >= a.min_score and r["title"] and title_ok(r["title"])], key=lambda r: (-r["score"], r["id"]))
        n = 0
        for r in pool:
            if n >= a.per_style: break
            if per_src[(style, r["provenance"]["gutenberg_id"])] >= max(2, a.per_style // 3): continue  # spread across collections
            per_src[(style, r["provenance"]["gutenberg_id"])] += 1; n += 1
            ex.append({"id": r["id"], "lang": "en", "style": style, "brief": brief_of(r["title"], style, r["stanzas"][0][0]), "text": r["text"], "judge": r["score"]})
    old = json.load(open(a.exemplars_out)) if os.path.exists(a.exemplars_out) else []
    json.dump([e for e in old if e["lang"] != "en"] + ex, open(a.exemplars_out, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print("en exemplars", len(ex), dict(collections.Counter(e["style"] for e in ex)))

p = argparse.ArgumentParser(); sp = p.add_subparsers(dest="cmd", required=True)
e = sp.add_parser("extract"); e.add_argument("--raw", default=f"{STORE}/raw")
b = sp.add_parser("build"); b.add_argument("--exemplars-out", required=True); b.add_argument("--per-style", type=int, default=8); b.add_argument("--min-score", type=float, default=4.0)
a = p.parse_args()
{"extract": cmd_extract, "build": cmd_build}[a.cmd](a)
