import json, numpy as np, collections, os, sys
sys.path.insert(0, "audio"); from score_audio import Scorer
R = [json.loads(l) for l in open("runs/pool-scores/pool_scores.jsonl")]; ok = [r for r in R if "error" not in r]
w = np.load("runs/pref-model/w.npy"); S = Scorer("cuda")
for r in ok: r["pref_score"] = float(S.clap_audio_emb(f"audio/pool_audio/{r['id']}.mp3") @ w)
with open("runs/pool-scores/pool_scores_pref.jsonl", "w") as f:
    for r in ok: f.write(json.dumps(r, ensure_ascii=False) + "\n")
def m(x): return round(float(np.mean(x)), 3)
by = collections.defaultdict(list)
for r in ok: by[r["language"]].append(r)
print("lang n PQ CE CU PC lang_match script_share wps distinct pref")
for l, rs in sorted(by.items(), key=lambda kv: -len(kv[1])):
    a = lambda k: m([r["aesthetics"][k] for r in rs]); wh = [r["whisper"] for r in rs]
    ss = [x["script_share"] for x in wh if x["script_share"] is not None]
    print(l, len(rs), a("PQ"), a("CE"), a("CU"), a("PC"), m([x["lang_match"] for x in wh]), m(ss) if ss else "-", m([x["words_per_s"] for x in wh]), m([x["distinct_ratio"] for x in wh]), m([r["pref_score"] for r in rs]))
print("ALL", len(ok), "clap_sim mean", m([r["clap_sim"] for r in ok]), "lang_match", m([r["whisper"]["lang_match"] for r in ok]))
print("low-intelligibility (wps<0.25 or lang mismatch):", sum(r["whisper"]["words_per_s"] < 0.25 or not r["whisper"]["lang_match"] for r in ok))
