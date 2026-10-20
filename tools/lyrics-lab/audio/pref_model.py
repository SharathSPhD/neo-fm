#!/usr/bin/env python3
"""Audio preference model on Music Arena battles (CC-BY-4.0). CLAP audio embeddings -> Bradley-Terry logistic regression on (emb_a - emb_b), antisymmetric by construction.
Held-out = whole prompts held out (GroupKFold), so a prompt never straddles train and test. Usage: pref_model.py [--limit N]"""
import glob, json, os, sys, numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
from score_audio import Scorer
ROOT = "data/hf/music-arena"; OUT = "runs/pref-model"; os.makedirs(OUT, exist_ok=True)
B = [json.load(open(f)) for f in glob.glob(f"{ROOT}/battle_data/*/*.json")]
B = [x for x in B if x["preference"] in ("A", "B") and x["audio_a"] and x["audio_b"] and os.path.exists(f"{ROOT}/{x['audio_a']}") and os.path.exists(f"{ROOT}/{x['audio_b']}")]
files = sorted({f"{ROOT}/{x[k]}" for x in B for k in ("audio_a", "audio_b")})
cache = f"{OUT}/emb.npz"; emb = dict(np.load(cache, allow_pickle=True)["d"].item()) if os.path.exists(cache) else {}
S = Scorer("cuda")
for i, f in enumerate(files):
    if f in emb: continue
    try: emb[f] = S.clap_audio_emb(f)
    except Exception as e: print("skip", f, repr(e)[:80])
    if i % 500 == 0: print(i, len(files), flush=True); np.savez(cache, d=np.array(emb, dtype=object))
np.savez(cache, d=np.array(emb, dtype=object))
rows = [x for x in B if f"{ROOT}/{x['audio_a']}" in emb and f"{ROOT}/{x['audio_b']}" in emb]
X = np.stack([emb[f"{ROOT}/{x['audio_a']}"] - emb[f"{ROOT}/{x['audio_b']}"] for x in rows]); y = np.array([x["preference"] == "A" for x in rows], int)
g = np.array([x["prompt"] for x in rows]); vocal = np.array([not x["is_instrumental"] for x in rows])
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
def fit(Xt, yt, C): return LogisticRegression(C=C, fit_intercept=False, max_iter=2000).fit(np.vstack([Xt, -Xt]), np.concatenate([yt, 1 - yt]))
res = {}
for C in (0.1, 1, 10, 100):
    pred = np.zeros(len(y), int)
    for tr, te in GroupKFold(5).split(X, y, g): pred[te] = fit(X[tr], y[tr], C).predict(X[te])
    res[C] = dict(acc=float((pred == y).mean()), acc_vocal=float((pred == y)[vocal].mean()), acc_instr=float((pred == y)[~vocal].mean()))
    print(C, res[C], flush=True)
best = max(res, key=lambda c: res[c]["acc"])
m = fit(X, y, best); np.save(f"{OUT}/w.npy", m.coef_[0])
json.dump({"n_battles": len(rows), "n_vocal": int(vocal.sum()), "majority_baseline": float(max(y.mean(), 1 - y.mean())), "grouped_5fold_cv": {str(k): v for k, v in res.items()}, "best_C": best}, open(f"{OUT}/result.json", "w"), indent=1)
