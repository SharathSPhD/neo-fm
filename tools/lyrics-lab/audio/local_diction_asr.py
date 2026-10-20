#!/usr/bin/env python3
"""Free local stand-in for the transcription half of qaDiction (Gemini hears the song, then the intended lines are compared).
This step transcribes sung audio on the 5090 and writes transcripts; score_transcripts.mjs then scores them with the
production scorer, so only the ASR differs from the Gemini path. No paid calls, audio is never committed.

usage: local_diction_asr.py manifest.json transcripts.json [--systems ml=whisper_ml_ft,default=whisper_v3]
manifest: [{"id", "language" (ml|kn|ta|te|hi|...), "audio" (path or https URL), "lyrics"}]
out:      the same rows plus "transcript", "system", "lang_detected"
Use the qbz506 Hugging Face token only (HF_TOKEN_FILE=~/.hf-qbz506/token)."""
import argparse, json, os, subprocess, time

MODELS = {"whisper_v3": "large-v3", "whisper_ml_ft": "rontroy/whisper-large-v3-malayalam-ct2"}  # ft: Apache-2.0
LANG_CODE = {"ml": "ml", "kn": "kn", "ta": "ta", "te": "te", "hi": "hi", "mr": "mr", "bn": "bn", "pa": "pa", "gu": "gu"}

def fetch(a, cache="diction_audio"):
    if not a.startswith("http"): return a
    os.makedirs(cache, exist_ok=True); p = os.path.join(cache, a.rstrip("/").split("/")[-1].split("?")[0] or "x.mp3")
    if not os.path.exists(p): subprocess.run(["curl", "-sfL", "-o", p, a], check=True)
    return p

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("manifest"); ap.add_argument("out")
    ap.add_argument("--systems", default="ml=whisper_ml_ft,default=whisper_v3"); a = ap.parse_args()
    pick = dict(kv.split("=") for kv in a.systems.split(","))
    tok = os.environ.get("HF_TOKEN_FILE")
    if tok and os.path.exists(os.path.expanduser(tok)): os.environ["HF_TOKEN"] = open(os.path.expanduser(tok)).read().strip()
    from faster_whisper import WhisperModel
    rows = json.load(open(a.manifest)); models = {}; out = []
    for r in rows:
        sysname = pick.get(r["language"], pick["default"])
        if sysname not in models: models[sysname] = WhisperModel(MODELS[sysname], device="cuda", compute_type="float16")
        m = models[sysname]; t0 = time.time(); path = fetch(r["audio"])
        segs, _ = m.transcribe(path, language=LANG_CODE.get(r["language"]), vad_filter=True, beam_size=5)
        text = "\n".join(s.text.strip() for s in segs if s.text.strip())
        det = m.transcribe(path, beam_size=1)[1]
        out.append({**r, "transcript": text, "system": sysname, "lang_detected": det.language, "sec": round(time.time() - t0, 1)})
        print(r["id"], sysname, len(text), flush=True)
    json.dump(out, open(a.out, "w"), ensure_ascii=False, indent=1)

if __name__ == "__main__": main()
