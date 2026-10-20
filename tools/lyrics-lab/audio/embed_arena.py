#!/usr/bin/env python3
"""Cache CLAP audio embeddings + Audiobox aesthetics for Music Arena clips (cc-by-4.0, music-arena/music-arena-dataset).
Reads battle_data/*/*.json (schema: battle_uuid, prompt, system_a/b, audio_a/b, preference in A|B|TIE|BOTH_BAD, ...). The user_pseudonym
field is never read or stored. Only battles with a clear A/B winner and both audio files on disk are kept.
python audio/embed_arena.py [--root data/hf/music-arena] [--limit-battles N] [--out data/arena_feats]
Writes <out>.npz (clip_ids, clap [N,512], aes [N,4]) and <out>_battles.jsonl (battle_uuid, a, b, winner, systems, prompt). Both gitignored."""
import argparse, glob, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__)); from score_audio import Scorer

def audio_path(root, v):
    if isinstance(v, dict): v = v.get("path")
    if not v: return None
    for p in (v, os.path.join(root, v), os.path.join(root, "audio_files", os.path.basename(os.path.dirname(v)), os.path.basename(v))):
        if os.path.isfile(p): return p
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="data/hf/music-arena"); ap.add_argument("--out", default="data/arena_feats"); ap.add_argument("--limit-battles", type=int, default=0)
    a = ap.parse_args()
    battles = []
    for f in sorted(glob.glob(f"{a.root}/battle_data/*/*.json")):
        d = json.load(open(f, encoding="utf-8"))
        if d.get("preference") not in ("A", "B"): continue
        pa, pb = audio_path(a.root, d.get("audio_a")), audio_path(a.root, d.get("audio_b"))
        if pa and pb: battles.append({"battle_uuid": d["battle_uuid"], "a": pa, "b": pb, "winner": d["preference"], "system_a": d.get("system_a"),
                                      "system_b": d.get("system_b"), "prompt": d.get("prompt"), "timestamp": d.get("timestamp")})
    battles.sort(key=lambda b: -(b["timestamp"] or 0))  # most recent first
    if a.limit_battles: battles = battles[:a.limit_battles]
    clips = sorted({p for b in battles for p in (b["a"], b["b"])})
    print(f"{len(battles)} A/B battles, {len(clips)} clips", flush=True)
    sc = Scorer(); clap, aes, ok = [], [], []
    for i, p in enumerate(clips):
        try:
            e = sc.clap_audio_emb(p); r = sc.aesthetics([p])[0]
        except Exception as ex: print("skip", p, repr(ex)[:80]); continue
        clap.append(e); aes.append([r["CE"], r["CU"], r["PC"], r["PQ"]]); ok.append(p)
        if i % 200 == 0: print(i, "/", len(clips), flush=True)
    keep = set(ok); battles = [b for b in battles if b["a"] in keep and b["b"] in keep]
    np.savez(a.out + ".npz", clip_ids=np.array(ok), clap=np.stack(clap), aes=np.array(aes, dtype=np.float32))
    with open(a.out + "_battles.jsonl", "w", encoding="utf-8") as f:
        for b in battles: f.write(json.dumps(b, ensure_ascii=False) + "\n")
    print("saved", len(ok), "clips,", len(battles), "battles")

if __name__ == "__main__": main()
