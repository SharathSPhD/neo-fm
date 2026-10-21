#!/usr/bin/env python3
"""Malayalam sung-lyrics ASR comparison on the public pool's ml tracks (fetched from the public CDN, read-only, no paid calls, audio never committed).
Systems: faster-whisper large-v3 (baseline), a permissively licensed Malayalam Whisper fine-tune (CT2), and AI4Bharat IndicConformer-600M (MIT, gated on HF: needs a token that accepted the terms).
There are no reference lyrics for pool songs, so scoring is reference-free: Malayalam-script share, detected language, words/s, repetition, and cross-system agreement (pairwise CER).
usage: asr_ml.py pool.json out.json [--max 30] [--systems whisper_v3,whisper_ml_ft,indicconformer]"""
import json, sys, os, re, argparse, unicodedata, subprocess, collections, itertools, time

def script_share(t):
    ch = [c for c in t if c.isalpha()]
    return round(sum("MALAYALAM" in unicodedata.name(c, "") for c in ch) / len(ch), 3) if ch else 0.0

def norm(t):
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", t)).strip()

def cer(a, b):
    import jiwer
    a, b = norm(a), norm(b)
    if not a and not b: return 0.0
    if not a or not b: return 1.0
    return round(jiwer.cer(a, b), 3)

def load_wav(p):
    import librosa
    return librosa.load(p, sr=16000, mono=True)[0]

def run_whisper(model_id, wavs, ids):
    from faster_whisper import WhisperModel
    m = WhisperModel(model_id, device="cuda", compute_type="float16"); out = {}
    for i in ids:
        t0 = time.time()
        segs, _ = m.transcribe(wavs[i], language="ml", vad_filter=True, beam_size=5)
        det = m.transcribe(wavs[i], beam_size=1)[1]
        out[i] = {"transcript": " ".join(s.text.strip() for s in segs).strip(), "lang_detected": det.language, "lang_prob": round(det.language_probability, 3), "sec": round(time.time() - t0, 1)}
    del m; return out

def run_indic(wavs, ids):
    import torch
    from transformers import AutoModel
    m = AutoModel.from_pretrained("ai4bharat/indic-conformer-600m-multilingual", trust_remote_code=True); out = {}
    for i in ids:
        t0 = time.time(); w = torch.from_numpy(wavs[i]).unsqueeze(0)
        out[i] = {"transcript": {d: m(w, "ml", d).strip() for d in ("ctc", "rnnt")}, "sec": round(time.time() - t0, 1)}
    return out

SYSTEMS = {"whisper_v3": lambda w, i: run_whisper("large-v3", w, i),
           "whisper_ml_ft": lambda w, i: run_whisper("rontroy/whisper-large-v3-malayalam-ct2", w, i),
           "indicconformer": run_indic}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("pool"); ap.add_argument("out"); ap.add_argument("--max", type=int, default=30)
    ap.add_argument("--systems", default="whisper_v3,whisper_ml_ft,indicconformer"); a = ap.parse_args()
    pool = [t for t in json.load(open(a.pool)) if t["language"] == "ml"][:a.max]
    os.makedirs("pool_audio", exist_ok=True); wavs = {}
    for t in pool:
        p = f"pool_audio/{t['id']}.mp3"
        if not os.path.exists(p): subprocess.run(["curl", "-sfL", "-o", p, t["url"]], check=True)
        wavs[t["id"]] = load_wav(p)
    ids = [t["id"] for t in pool]; res = {}; errors = {}
    for name in a.systems.split(","):
        try: res[name] = SYSTEMS[name](wavs, ids)
        except Exception as e: errors[name] = repr(e)[:300]; print(name, "FAILED", errors[name], file=sys.stderr)
    flat = {}  # system -> id -> transcript string
    for s, r in res.items():
        for i, v in r.items():
            if isinstance(v["transcript"], dict):
                for d, tx in v["transcript"].items(): flat.setdefault(f"{s}_{d}", {})[i] = tx
            else: flat.setdefault(s, {})[i] = v["transcript"]
    tracks = []
    for t in pool:
        i = t["id"]; row = {"id": i, "title": t["title"], "dur": t.get("durationSeconds"), "systems": {}}
        for s, d in flat.items():
            tx = d[i]; w = tx.split(); c = collections.Counter(w)
            row["systems"][s] = {"transcript": tx, "ml_script_share": script_share(tx), "words": len(w), "words_per_s": round(len(w) / max(1, t.get("durationSeconds") or 1), 3), "distinct_ratio": round(len(c) / max(1, len(w)), 3)}
            for sys_, r in res.items():
                if s.startswith(sys_) and not isinstance(r[i]["transcript"], dict): row["systems"][s].update(lang_detected=r[i]["lang_detected"], lang_prob=r[i]["lang_prob"])
        row["agreement_cer"] = {f"{x}|{y}": cer(flat[x][i], flat[y][i]) for x, y in itertools.combinations(flat, 2)}
        tracks.append(row)
    n = len(tracks)
    summary = {s: {"mean_ml_script_share": round(sum(r["systems"][s]["ml_script_share"] for r in tracks) / n, 3),
                   "mean_words_per_s": round(sum(r["systems"][s]["words_per_s"] for r in tracks) / n, 3),
                   "mean_distinct_ratio": round(sum(r["systems"][s]["distinct_ratio"] for r in tracks) / n, 3),
                   "empty_tracks": sum(1 for r in tracks if not r["systems"][s]["words"]),
                   "lang_ml_rate": round(sum(r["systems"][s].get("lang_detected") == "ml" for r in tracks) / n, 3) if any("lang_detected" in r["systems"][s] for r in tracks) else None} for s in flat}
    pairs = {k: round(sum(r["agreement_cer"][k] for r in tracks) / n, 3) for k in tracks[0]["agreement_cer"]} if tracks else {}
    json.dump({"n_tracks": n, "systems": list(flat), "errors": errors, "summary": summary, "mean_pairwise_cer": pairs, "tracks": tracks}, open(a.out, "w"), ensure_ascii=False, indent=1)

if __name__ == "__main__": main()
