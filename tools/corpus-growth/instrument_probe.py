#!/usr/bin/env python3
"""Free probe: does naming an instrument in a Lyria prompt put that instrument in the audio?
For existing renders whose prompt names instruments, score each file against every instrument in instruments.json with zero-shot CLAP
(laion/clap-htsat-unfused, Apache-2.0, CPU) and compare, per instrument, files where the prompt NAMED it vs files where it did not
(AUC of the CLAP score, plus mean z-score gap). AUC 0.5 = naming has no effect; 1.0 = always detectable. A detector caveat applies:
CLAP may not separate similar instruments (sitar/sarod/veena), so a low AUC means 'not detectable', not always 'not played'.

Usage: instrument_probe.py OUT.json DIR[:manifest.json] ..."""
import json, os, re, sys, glob
import numpy as np, torch, librosa
from transformers import ClapModel, ClapProcessor

HERE = os.path.dirname(os.path.abspath(__file__))
# alias -> canonical instrument; matched against the render prompt
ALIAS = {"veena": ["veena", "vina"], "mridangam": ["mridangam"], "violin": ["violin"], "ghatam": ["ghatam"], "flute": ["flute", "bansuri", "venu"], "nadaswaram": ["nadaswaram", "nadhaswaram"],
         "thavil": ["thavil"], "tanpura": ["tanpura", "tambura"], "sitar": ["sitar"], "sarod": ["sarod"], "tabla": ["tabla"], "sarangi": ["sarangi"], "harmonium": ["harmonium"],
         "shehnai": ["shehnai"], "santoor": ["santoor"], "dhol": ["dhol"], "dholak": ["dholak"], "ektara": ["ektara"], "piano": ["piano"], "acoustic guitar": ["acoustic guitar", "guitar"],
         "electric guitar": ["electric guitar"], "harp": ["harp"], "dhak": ["dhak"], "rhodes": ["rhodes"], "brass": ["brass"], "strings": ["strings", "string section"]}
TEXT = {"veena": "a veena, an Indian plucked string instrument", "mridangam": "a mridangam, a South Indian two-headed drum", "violin": "a violin", "ghatam": "a ghatam clay pot percussion",
        "flute": "a bamboo flute", "nadaswaram": "a nadaswaram, a loud South Indian double-reed horn", "thavil": "a thavil drum", "tanpura": "a tanpura drone", "sitar": "a sitar",
        "sarod": "a sarod", "tabla": "tabla drums", "sarangi": "a sarangi bowed instrument", "harmonium": "a harmonium reed organ", "shehnai": "a shehnai oboe-like horn", "santoor": "a santoor hammered dulcimer",
        "dhol": "a dhol, a large double-headed drum", "dholak": "a dholak hand drum", "ektara": "an ektara single-string folk instrument", "piano": "a piano", "acoustic guitar": "an acoustic guitar",
        "electric guitar": "an electric guitar", "harp": "a harp", "dhak": "a dhak drum", "rhodes": "a Rhodes electric piano", "brass": "a brass section", "strings": "an orchestral string section"}

def emb(x):
    return x if torch.is_tensor(x) else x.pooler_output

def named(prompt):
    p = prompt.lower(); return {k for k, al in ALIAS.items() if any(re.search(r"\b" + a, p) for a in al)}

def main(out, *srcs):
    items = []
    for s in srcs:
        d, _, mf = s.partition(":"); mf = mf or "manifest.json"
        m = json.load(open(os.path.join(d, mf)))
        for k, v in (m.items() if isinstance(m, dict) else [(x["id"], x) for x in m]):
            f = os.path.join(d, k + ".mp3")
            if os.path.exists(f) and v.get("prompt"): items.append((f, v["prompt"]))
    model = ClapModel.from_pretrained("laion/clap-htsat-unfused").eval(); proc = ClapProcessor.from_pretrained("laion/clap-htsat-unfused")
    keys = list(TEXT)
    with torch.no_grad():
        t = emb(model.get_text_features(**proc(text=[TEXT[k] for k in keys], return_tensors="pt", padding=True))); t = t / t.norm(dim=-1, keepdim=True)
    rows = []
    for f, prompt in items:
        y, _ = librosa.load(f, sr=48000, mono=True, duration=150)
        wins = [y[i:i + 480000] for i in range(0, max(1, len(y) - 480000), 480000 * 2)][:6] or [y]
        with torch.no_grad():
            a = emb(model.get_audio_features(**proc(audio=wins, sampling_rate=48000, return_tensors="pt"))); a = a / a.norm(dim=-1, keepdim=True)
        sc = (a @ t.T).mean(0).numpy()
        rows.append({"file": os.path.basename(f), "dir": os.path.basename(os.path.dirname(f)), "prompt": prompt, "named": sorted(named(prompt)), "score": {k: float(v) for k, v in zip(keys, sc)}})
        print(rows[-1]["file"], rows[-1]["named"], flush=True)
    S = np.array([[r["score"][k] for k in keys] for r in rows]); Z = (S - S.mean(0)) / (S.std(0) + 1e-9)
    res = {}
    for j, k in enumerate(keys):
        pos = [i for i, r in enumerate(rows) if k in r["named"]]; neg = [i for i, r in enumerate(rows) if k not in r["named"]]
        if len(pos) < 2 or len(neg) < 2: continue
        auc = float(np.mean([Z[p, j] > Z[n, j] for p in pos for n in neg]))
        rank1 = float(np.mean([int(np.argmax(Z[p])) == j for p in pos]))
        res[k] = {"n_named": len(pos), "n_control": len(neg), "auc": round(auc, 3), "z_gap": round(float(Z[pos, j].mean() - Z[neg, j].mean()), 2), "top1_share": round(rank1, 2)}
    json.dump({"per_instrument": res, "rows": rows, "n_files": len(rows), "model": "laion/clap-htsat-unfused"}, open(out, "w"), indent=1, ensure_ascii=False)
    for k, v in sorted(res.items(), key=lambda x: -x[1]["auc"]): print(f"{k:16s} {v}")

if __name__ == "__main__": main(*sys.argv[1:])
