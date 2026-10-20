import json, random, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bench"))
LANG = {"kn": "Kannada", "hi": "Hindi", "te": "Telugu", "ta": "Tamil", "mr": "Marathi"}
NOTES = {"te": "Telugu: prasa between paired lines, equal matra counts, spoken-literary register.",
 "ta": "Tamil: edugai/monai echo across paired lines, no Sanskrit padding.",
 "kn": "Kannada: dvitiyakshara prasa, balanced matra counts.",
 "hi": "Hindi: one consistent register, antyaprasa on paired lines, no Hinglish.",
 "mr": "Marathi: natural spoken Marathi, antyaprasa on paired lines."}
STRUCT = "This is a 30-second song: about 8 short lines in total (a 2-line hook plus two 2-line verses), roughly 40-70 words. Do not write more."

def verse_prompt(lang, spec):
    return (f"Write {spec['lines']} lines of {LANG[lang]} verse in native script. Each line about {spec['syl_per_line']} syllables; "
            f"paired lines end-rhyme. Output only the verse.")

def song_prompt(lang, style, brief):
    # same shape as the production writePrompt (apps/web/lib/eval/judge.ts) so tuned models transfer
    return (f"Write original song lyrics in {LANG[lang]} (native script only, no transliteration, no translation) in the style family "
            f"\"{style}\". Brief: {brief}. {STRUCT} Use section tags like [Hook]/[Verse] as fits the style. {NOTES[lang]} Output only the lyrics.")

SCENES = ["a mother's lullaby on a hot summer night", "the first day of school", "a fishing village at dawn", "a wedding procession",
 "an old teacher remembered by a former student", "a festival of lamps", "a farmer praying for harvest", "a love letter read aloud",
 "a temple bell across the river", "a rainy bus ride home", "friends parting at a railway station", "a grandmother's stories at twilight",
 "spring blossoms and a new beginning", "a street singer in a crowded market", "a lost childhood home", "dancers rehearsing before a show",
 "the sea at night and a sailor's longing", "a morning prayer in a small shrine", "a harvest-moon night with folk drums",
 "a bride's farewell to her village", "a city worker dreaming of the village", "a river crossing in monsoon floods",
 "a mountain village waiting for snow-melt", "a birthday for a child who loves kites", "an anniversary after thirty years"]
MOODS = ["tender", "joyful", "wistful", "devotional", "playful", "bittersweet"]
STYLES = {"kn": ["kannada-folk", "bhavageete", "kannada-pop", "devaranama-inspired"], "hi": ["bollywood-ballad", "hindi-folk", "hindustani", "hindi-pop"],
 "te": ["telugu-folk", "telugu-keerthana", "telugu-light", "telugu-pop"], "ta": ["tamil-folk", "tamil-light-classical", "tamil-pop", "bhakti-inspired"],
 "mr": ["marathi-folk", "bhavgeet", "marathi-pop", "abhang-inspired"]}

def train_briefs(n_per_lang, seed=0, exclude=()):
    """Deterministic training briefs, disjoint from LyricBench-5 text."""
    rnd = random.Random(seed); out = []
    for lc in LANG:
        seen = set(exclude)
        while sum(1 for b in out if b["lang"] == lc) < n_per_lang:
            text = f"A {rnd.choice(MOODS)} song about {rnd.choice(SCENES)}"
            if text in seen: continue
            seen.add(text)
            out.append({"id": f"{lc}-t{len(out)}", "lang": lc, "language": LANG[lc], "style": rnd.choice(STYLES[lc]), "brief": text})
    return out

def read_jsonl(p): return [json.loads(l) for l in open(p, encoding="utf-8")]
