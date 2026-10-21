#!/usr/bin/env python3
"""Free sung-diction transcripts from the open per-language AI4Bharat IndicConformer NeMo models (MIT, no gate).
usage: indicconformer_diction.py manifest.json out.json [--decoder ctc|rnnt]
manifest rows: {"id","language" (kn|hi),"audio" (path),"lyrics"}; out adds "transcript". Score with score_transcripts.mjs.
Audio decoded with ffmpeg to 16 kHz mono wav in a temp dir; nothing is committed."""
import argparse, json, os, subprocess, tempfile
ap = argparse.ArgumentParser(); ap.add_argument("manifest"); ap.add_argument("out"); ap.add_argument("--decoder", default="ctc"); a = ap.parse_args()
import nemo.collections.asr as nemo_asr
rows = json.load(open(a.manifest)); models = {}; tmp = tempfile.mkdtemp(); out = []
for r in rows:
    lg = r["language"]
    if lg not in models:
        m = nemo_asr.models.ASRModel.from_pretrained(f"ai4bharat/indicconformer_stt_{lg}_hybrid_ctc_rnnt_large"); m.eval()
        m.cur_decoder = a.decoder; models[lg] = m
    wav = os.path.join(tmp, r["id"] + ".wav")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", r["audio"], "-ac", "1", "-ar", "16000", wav], check=True)
    res = models[lg].transcribe([wav], batch_size=1, logprobs=False, language_id=lg) if False else models[lg].transcribe([wav], batch_size=1)
    t = res[0]; t = t[0] if isinstance(t, (list, tuple)) else t
    t = getattr(t, "text", t)
    out.append({**r, "transcript": str(t).strip()}); print(r["id"], str(t)[:80])
json.dump(out, open(a.out, "w"), ensure_ascii=False, indent=1)
