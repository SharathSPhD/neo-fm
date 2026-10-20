"""Deterministic form score for Indic song lyrics (kn/hi/te/ta/mr), used as a candidate-SELECTION term only.

Port of the lyrics-lab `lyricmetrics.py` (itself a port of apps/web/lib/diction aksharas). It never drives a revision:
forcing syllable counts through repair loops lost on diction in the lab's runs, but choosing among K candidates by this
score won (see ananda.PROSODY_SELECT). Stdlib only, no model call. Score is 0-1, higher is better.
"""
from __future__ import annotations

import re
import statistics as st
import unicodedata


def _blk(cp: int) -> int | None:
    for b in (0x900, 0xB80, 0xC00, 0xC80):
        if b <= cp < b + 0x80:
            return cp - b
    return None


def _cons(o: int) -> bool:
    return 0x15 <= o <= 0x39 or 0x58 <= o <= 0x5F


def _ind(o: int) -> bool:
    return 0x04 <= o <= 0x14


def _vsign(o: int) -> bool:
    return 0x3E <= o <= 0x4C


_LONG_S = {0x3E, 0x40, 0x42, 0x44, 0x47, 0x48, 0x4A, 0x4B, 0x4C}
_LONG_I = {0x06, 0x08, 0x0A, 0x0C, 0x0F, 0x10, 0x13, 0x14}


def aksharas(text: str) -> list[dict]:
    cps = [ord(c) for c in unicodedata.normalize("NFC", text)]
    out: list[dict] = []
    i = 0
    while i < len(cps):
        o = _blk(cps[i])
        if o is None or not (_cons(o) or _ind(o)):
            i += 1
            continue
        s = i
        guru = False
        conj = False
        if _ind(o):
            guru = o in _LONG_I
            i += 1
        else:
            i += 1
            while True:
                n = _blk(cps[i]) if i < len(cps) else None
                if n == 0x3C:
                    i += 1
                    continue
                if n is not None and n == 0x4D and i + 1 < len(cps):
                    m = _blk(cps[i + 1])
                    if m is not None and _cons(m):
                        conj = True
                        i += 2
                        continue
                    i += 1
                    break
                break
            v = _blk(cps[i]) if i < len(cps) else None
            if v is not None and _vsign(v) and v != 0x3C:
                guru = guru or v in _LONG_S
                i += 1
        while i < len(cps):
            m = _blk(cps[i])
            if m is not None and m in (0x01, 0x02, 0x03):
                if m != 0x01:
                    guru = True
                i += 1
            else:
                break
        out.append({"t": "".join(map(chr, cps[s:i])), "guru": guru, "conj": conj})
    for k in range(len(out) - 1):
        if out[k + 1]["conj"]:
            out[k]["guru"] = True
    return out


def lyric_lines(text: str) -> list[str]:
    ls: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if re.fullmatch(r"\**[\[\(（].*[\]\)）]\**:?", line) or re.fullmatch(r"\*{2}[^*]+\*{2}", line):
            continue
        ls.append(line)
    return ls


def _vowel_of(ak: str) -> int:
    for c in reversed(ak):
        o = _blk(ord(c))
        if o is not None and (_vsign(o) or _ind(o)):
            return o
    return 0x00


def _cons_of(ak: str) -> int | None:
    for c in ak:
        o = _blk(ord(c))
        if o is not None and _cons(o):
            return o
    return None


def _language(text: str) -> str:
    """Dominant script block -> the language family whose rhyme convention applies (Devanagari: hi/mr)."""
    counts = {0x900: 0, 0xB80: 0, 0xC00: 0, 0xC80: 0}
    for c in text:
        cp = ord(c)
        for b in counts:
            if b <= cp < b + 0x80:
                counts[b] += 1
    top = max(counts, key=lambda b: counts[b])
    return {0x900: "hi", 0xB80: "ta", 0xC00: "te", 0xC80: "kn"}[top] if counts[top] else "other"


def _rhyme_pair(l1: str, l2: str, lang: str) -> float:
    a, b = aksharas(l1), aksharas(l2)
    if len(a) < 2 or len(b) < 2:
        return 0.0
    ea, eb = a[-1]["t"], b[-1]["t"]
    if ea == eb:
        return 1.0
    if _cons_of(ea) == _cons_of(eb) and _vowel_of(ea) == _vowel_of(eb):
        return 1.0
    if _vowel_of(ea) == _vowel_of(eb) and _vowel_of(a[-2]["t"]) == _vowel_of(b[-2]["t"]):
        return 0.7
    if lang in ("te", "kn", "ta") and _cons_of(a[1]["t"]) == _cons_of(b[1]["t"]) and _cons_of(a[1]["t"]) is not None:
        return 0.6
    if _vowel_of(ea) == _vowel_of(eb):
        return 0.4
    return 0.0


def form_score(text: str, target_lines: tuple[int, int] = (4, 9), target_syl: tuple[int, int] = (8, 18)) -> float | None:
    """0-1 form score (script purity, structure, couplet metre, couplet rhyme, diversity); None when there is no Indic text."""
    ls = lyric_lines(text)
    n = len(ls)
    if n == 0:
        return None
    letters = [c for line in ls for c in line if c.isalpha()]
    if not letters:
        return None
    indic = sum(1 for c in letters if 0x900 <= ord(c) < 0xD00)
    if indic == 0:
        return None
    lang = _language(text)
    counts = [len(aksharas(line)) for line in ls]
    script = indic / len(letters)
    lc = 1.0 if target_lines[0] <= n <= target_lines[1] else max(0.0, 1 - min(abs(n - target_lines[0]), abs(n - target_lines[1])) / 6)
    inr = sum(target_syl[0] <= c <= target_syl[1] for c in counts) / n
    pairs = [(counts[i], counts[i + 1]) for i in range(0, n - 1, 2) if counts[i] and counts[i + 1]]
    meter_pair = st.mean([max(0.0, 1 - abs(a - b) / max(a, b) / 0.3) for a, b in pairs]) if pairs else 0.0
    mean_c = st.mean(counts)
    cv = (st.pstdev(counts) / mean_c) if mean_c else 1.0
    meter = 0.6 * meter_pair + 0.4 * max(0.0, 1 - cv / 0.35)
    rs = [_rhyme_pair(ls[i], ls[i + 1], lang) for i in range(0, n - 1, 2)]
    rhyme = st.mean(rs) if rs else 0.0
    uniq = list(dict.fromkeys(ls))
    words = [w for line in uniq for w in re.findall(r"[^\W\d_]+", line)]
    ttr = len(set(words)) / max(1, len(words))
    return float(max(0.0, min(1.0, 0.15 * script + 0.15 * (0.5 * lc + 0.5 * inr) + 0.30 * meter + 0.25 * rhyme + 0.15 * min(1.0, ttr / 0.8))))
