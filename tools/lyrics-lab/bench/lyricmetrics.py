"""Deterministic lyric metrics for kn/hi/te/ta/mr (stdlib only). Port of apps/web/lib/diction aksharas().
Score components are 0-1 (higher is better). Used as cheap reward / pre-filter next to AI judges."""
import re, unicodedata, itertools, statistics as st

BLOCKS = {"hi": 0x900, "mr": 0x900, "kn": 0xC80, "te": 0xC00, "ta": 0xB80}
def _blk(cp):
    for b in (0x900, 0xB80, 0xC00, 0xC80):
        if b <= cp < b + 0x80: return cp - b
    return None
def _cons(o): return 0x15 <= o <= 0x39 or 0x58 <= o <= 0x5F
def _ind(o): return 0x04 <= o <= 0x14
def _vir(o): return o == 0x4D
def _vsign(o): return 0x3E <= o <= 0x4C
def _mod(o): return o in (0x01, 0x02, 0x03)
LONG_S = {0x3E,0x40,0x42,0x44,0x47,0x48,0x4A,0x4B,0x4C}; LONG_I = {0x06,0x08,0x0A,0x0C,0x0F,0x10,0x13,0x14}

def aksharas(text):
    cps = [ord(c) for c in unicodedata.normalize("NFC", text)]; out=[]; i=0
    while i < len(cps):
        o = _blk(cps[i])
        if o is None or not (_cons(o) or _ind(o)): i+=1; continue
        s=i; guru=False; conj=False
        if _ind(o):
            guru = o in LONG_I; i+=1
        else:
            i+=1
            while True:
                n = _blk(cps[i]) if i < len(cps) else None
                if n == 0x3C: i+=1; continue
                if n is not None and _vir(n) and i+1 < len(cps):
                    m = _blk(cps[i+1])
                    if m is not None and _cons(m): conj=True; i+=2; continue
                    i+=1; break
                break
            v = _blk(cps[i]) if i < len(cps) else None
            if v is not None and _vsign(v) and v != 0x3C:
                guru = guru or v in LONG_S; i+=1
        while i < len(cps):
            m = _blk(cps[i])
            if m is not None and _mod(m):
                if m != 0x01: guru=True
                i+=1
            else: break
        out.append({"t": "".join(map(chr, cps[s:i])), "guru": guru, "conj": conj})
    for k in range(len(out)-1):
        if out[k+1]["conj"]: out[k]["guru"] = True
    return out

def lyric_lines(text):
    ls=[]
    for l in text.splitlines():
        l=l.strip()
        if not l or l.startswith("#"): continue
        if re.fullmatch(r"\**[\[\(（].*[\]\)）]\**:?", l) or re.fullmatch(r"\*{2}[^*]+\*{2}", l): continue
        ls.append(l)
    return ls

def _latin_ratio(s):
    letters=[c for c in s if c.isalpha()]
    return 0 if not letters else sum(1 for c in letters if c.isascii())/len(letters)

def _ends(line):
    a = aksharas(line); return a
def _vowel_of(ak):
    # final vowel sign / inherent 'a' of an akshara, language-agnostic offset
    for c in reversed(ak):
        o=_blk(ord(c))
        if o is not None and (_vsign(o) or _ind(o)): return o
    return 0x00  # inherent a
def _cons_of(ak):
    for c in ak:
        o=_blk(ord(c))
        if o is not None and _cons(o): return o
    return None

def rhyme_pair(l1, l2, lang):
    """Return 1.0 antyaprasa (final akshara vowel+consonant match), 0.7 end-vowel + near-match, 0.6 dvitiyakshara prasa, 0 none."""
    a, b = aksharas(l1), aksharas(l2)
    if len(a)<2 or len(b)<2: return 0.0
    ea, eb = a[-1]["t"], b[-1]["t"]
    if ea == eb: return 1.0
    if _cons_of(ea)==_cons_of(eb) and _vowel_of(ea)==_vowel_of(eb): return 1.0
    ends_vowel = _vowel_of(ea)==_vowel_of(eb) and _vowel_of(a[-2]["t"])==_vowel_of(b[-2]["t"])
    if ends_vowel: return 0.7
    # dvitiyakshara prasa (2nd syllable consonant echo) - Telugu/Kannada/Tamil convention
    if lang in ("te","kn","ta") and _cons_of(a[1]["t"])==_cons_of(b[1]["t"]) and _cons_of(a[1]["t"]) is not None: return 0.6
    if _vowel_of(ea)==_vowel_of(eb): return 0.4
    return 0.0

def score(text, lang, target_lines=(4,9), target_syl=(8,18)):
    ls = lyric_lines(text); n=len(ls)
    if n==0: return {"valid":0}
    counts=[len(aksharas(l)) for l in ls]
    # 1 script purity: share of letters that are in the target script (no latin/other scripts)
    letters=[c for l in ls for c in l if c.isalpha()]
    tgt=sum(1 for c in letters if _blk(ord(c)) is not None and _blk(ord(c)) is not None and (0x900<=ord(c)<0xD00))
    script=tgt/max(1,len(letters))
    # 2 structure: line count + per-line length inside range
    lc = 1.0 if target_lines[0]<=n<=target_lines[1] else max(0,1-min(abs(n-target_lines[0]),abs(n-target_lines[1]))/6)
    inr = sum(target_syl[0]<=c<=target_syl[1] for c in counts)/n
    # 3 meter: paired-line syllable closeness (couplets 1-2,3-4...) and overall CV
    pairs=[(counts[i],counts[i+1]) for i in range(0,n-1,2) if counts[i] and counts[i+1]]
    meter_pair = st.mean([max(0,1-abs(a-b)/max(a,b)/0.3) for a,b in pairs]) if pairs else 0
    exact = st.mean([abs(a-b)<=1 for a,b in pairs]) if pairs else 0
    cv = (st.pstdev(counts)/st.mean(counts)) if st.mean(counts) else 1
    meter = 0.6*meter_pair + 0.4*max(0,1-cv/0.35)
    # 4 rhyme: couplet rhyme (1-2,3-4) with best of adjacent/alternate
    rs=[rhyme_pair(ls[i],ls[i+1],lang) for i in range(0,n-1,2)]
    rhyme = st.mean(rs) if rs else 0
    rhyme_rate = st.mean([r>=0.6 for r in rs]) if rs else 0
    # 5 diversity: distinct word-level unigram ratio excluding deliberate hook repeats (dedupe identical lines first)
    uniq=list(dict.fromkeys(ls)); words=[w for l in uniq for w in re.findall(r"[^\W\d_]+", l)]
    ttr=len(set(words))/max(1,len(words))
    hook_repeat = 1 - len(uniq)/n
    # 6 english leakage
    lat=max(_latin_ratio(l) for l in ls)
    return {"valid":1,"lines":n,"mean_syl":round(st.mean(counts),1),"script":round(script,3),"structure":round(0.5*lc+0.5*inr,3),
            "meter":round(meter,3),"pair_within1":round(exact,3),"rhyme":round(rhyme,3),"rhyme_rate":round(rhyme_rate,3),
            "diversity":round(min(1,ttr/0.8),3),"hook_repeat":round(hook_repeat,3),"latin_max":round(lat,3),
            "det":round(100*(0.15*script+0.15*(0.5*lc+0.5*inr)+0.30*meter+0.25*rhyme+0.15*min(1,ttr/0.8)),1)}
