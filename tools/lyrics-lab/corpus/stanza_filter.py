#!/usr/bin/env python3
"""Cut corpus pages into singable stanzas and keep only windows that look like metrical verse.

A window is 4 or 6 consecutive non-empty lines. Kept when line lengths are steady, couplets rhyme (lyricmetrics) and the
text is mostly the target script with no verse-number noise. Output rows carry the deterministic spec used as the SFT
prompt (n lines, syllables per line, rhyme rate), so the model learns to hit numeric constraints without drifting on words.

Usage: stanza_filter.py OUT.jsonl IN1.jsonl [IN2.jsonl ...]
"""
import sys, json, re, hashlib, statistics as st, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bench"))
import lyricmetrics as lm

DROP_TITLE = re.compile(r"திருவிவிலியம்|பைபிள்|Bible|ವಿಶ್ವಕೋಶ|विश्वकोश|వేద|అధ్యాయము|పర్వము|శ్లోక|సంస్కృత|उपनिषद्|संहिता", re.I)
PER_TITLE_CAP = 40  # keep sources diverse; one long poem must not dominate

def windows(lines, size):
    for i in range(0, len(lines) - size + 1, size):
        yield lines[i:i + size]

def keep(win, lang):
    if any(re.search(r"\d", l) and len(re.findall(r"\d", l)) / len(l) > 0.05 for l in win): return None
    if any(re.search(r"[A-Za-z]{3}", l) for l in win): return None
    text = "\n".join(win)
    s = lm.score(text, lang, (len(win), len(win)), (6, 22))
    if not s.get("valid"): return None
    c = [len(lm.aksharas(l)) for l in win]
    if min(c) < 6 or max(c) > 22: return None
    if s["script"] < 0.97 or s["meter"] < 0.75 or s["rhyme_rate"] < 0.5 or s["pair_within1"] < 0.5: return None
    return s, c

def main(out, *ins):
    seen = set(); n = 0; per = {}; per_title = {}
    with open(out, "w", encoding="utf-8") as fo:
        for f in ins:
            for row in map(json.loads, open(f, encoding="utf-8")):
                if DROP_TITLE.search(row.get("title", "")): continue
                lines = [l for l in row["text"].split("\n") if l.strip()]
                for size in (4, 6):
                    for win in windows(lines, size):
                        k = keep(win, row["lang"])
                        if not k: continue
                        tk = (row['lang'], row['title'])
                        if per_title.get(tk, 0) >= PER_TITLE_CAP: continue
                        per_title[tk] = per_title.get(tk, 0) + 1
                        s, c = k; text = "\n".join(win); h = hashlib.sha1(text.encode()).hexdigest()
                        if h in seen: continue
                        seen.add(h); n += 1; per[row["lang"]] = per.get(row["lang"], 0) + 1
                        fo.write(json.dumps({"id": h[:12], "lang": row["lang"], "source": row["source"], "title": row["title"], "text": text,
                            "spec": {"lines": size, "syl_per_line": round(st.mean(c)), "rhyme_rate": s["rhyme_rate"]}, "det": s["det"],
                            "licence_note": row.get("licence_note", "")}, ensure_ascii=False) + "\n")
    print("stanzas", n, per)

if __name__ == "__main__": main(*sys.argv[1:])
