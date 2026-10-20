#!/usr/bin/env python3
"""Open-licence audio scoring for generated songs. Licences: audiobox-aesthetics CC-BY-4.0, laion/larger_clap_music Apache-2.0,
faster-whisper large-v3 MIT. No NC models (SongEval, MusicEval, MuQ).
python audio/score_audio.py song.mp3 [--lyrics-file lyrics.txt] [--prompt "kannada folk, rain"] [--lang kn]
Returns JSON: aesthetics {CE,CU,PC,PQ}, clap_sim (audio vs prompt text, cosine), whisper {cer,wer,transcript} when lyrics are given."""
import argparse, json, re, sys, unicodedata
import numpy as np

CLAP_ID = "laion/larger_clap_music"; CLAP_SR = 48000; CLAP_WIN = 10.0; CLAP_WINDOWS = 3

def norm_text(t):
    t = unicodedata.normalize("NFC", re.sub(r"\[[^\]]*\]|\([^)]*\)|\|+", " ", t or ""))
    t = "".join(c if not unicodedata.category(c)[0] in "PS" else " " for c in t).lower()
    return re.sub(r"\s+", " ", t).strip()

def edit_distance(a, b):
    if not a: return len(b)
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1): cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]

def cer_wer(ref, hyp):
    r, h = norm_text(ref), norm_text(hyp)
    rc, hc = r.replace(" ", ""), h.replace(" ", "")
    cer = edit_distance(rc, hc) / max(1, len(rc)); wer = edit_distance(r.split(), h.split()) / max(1, len(r.split()))
    return round(min(cer, 1.5), 4), round(min(wer, 1.5), 4)

class Scorer:
    """Lazy-loads each model on first use so callers can ask for one signal only."""
    def __init__(self, device="cuda"):
        self.device = device; self._aes = self._clap = self._whisper = None

    # ---- Audiobox aesthetics -------------------------------------------------------------
    def aesthetics(self, paths):
        if self._aes is None:
            from audiobox_aesthetics.infer import initialize_predictor
            self._aes = initialize_predictor()
        import librosa, torch
        batch = []
        for p in paths:  # decode ourselves: torchaudio's loader needs torchcodec, which this box does not have
            wav, sr = librosa.load(str(p), sr=None, mono=True)
            batch.append({"path": torch.from_numpy(wav)[None, :], "sample_rate": sr})
        return [{k: round(float(v), 4) for k, v in r.items()} for r in self._aes.forward(batch)]

    # ---- CLAP ------------------------------------------------------------------------
    def _load_clap(self):
        if self._clap is None:
            import torch
            from transformers import ClapModel, ClapProcessor
            self._clap = (ClapModel.from_pretrained(CLAP_ID).to(self.device).eval(), ClapProcessor.from_pretrained(CLAP_ID))
        return self._clap

    def clap_audio_emb(self, path):
        """Mean of up to 3 evenly spaced 10 s windows, L2-normalised; CLAP's training window is 10 s."""
        import librosa, torch
        model, proc = self._load_clap()
        wav, _ = librosa.load(str(path), sr=CLAP_SR, mono=True)
        w = int(CLAP_WIN * CLAP_SR)
        starts = [0] if len(wav) <= w else sorted({int(s) for s in np.linspace(0, len(wav) - w, CLAP_WINDOWS)})
        chunks = [wav[s:s + w] for s in starts]
        with torch.no_grad():
            feats = proc(audio=chunks, sampling_rate=CLAP_SR, return_tensors="pt").to(self.device)
            e = model.get_audio_features(**feats)
        e = e.pooler_output if hasattr(e, "pooler_output") else e
        e = e.float().mean(0); return (e / e.norm()).cpu().numpy()

    def clap_text_emb(self, text):
        import torch
        model, proc = self._load_clap()
        with torch.no_grad():
            e = model.get_text_features(**proc(text=[text], return_tensors="pt", padding=True).to(self.device))
        e = e.pooler_output if hasattr(e, "pooler_output") else e
        e = e.float()[0]; return (e / e.norm()).cpu().numpy()

    def clap_sim(self, path, text, audio_emb=None):
        a = self.clap_audio_emb(path) if audio_emb is None else audio_emb
        return round(float(a @ self.clap_text_emb(text)), 4)

    # ---- Whisper ---------------------------------------------------------------------
    def transcribe(self, path, lang=None):
        if self._whisper is None:
            from faster_whisper import WhisperModel
            self._whisper = WhisperModel("large-v3", device=self.device, compute_type="float16" if self.device == "cuda" else "int8")
        import librosa  # decode ourselves: faster-whisper's PyAV decode breaks on PyAV 19
        wav, _ = librosa.load(str(path), sr=16000, mono=True)
        segs, info = self._whisper.transcribe(wav, language=lang, vad_filter=True, beam_size=5)
        return " ".join(s.text.strip() for s in segs), info.language

    # ---- all-in-one ------------------------------------------------------------------
    def score(self, path, lyrics=None, prompt=None, lang=None):
        out = {"path": str(path), "aesthetics": self.aesthetics([path])[0]}
        if prompt: out["clap_sim"] = self.clap_sim(path, prompt)
        if lyrics:
            hyp, det = self.transcribe(path, lang)
            cer, wer = cer_wer(lyrics, hyp)
            out["whisper"] = {"cer": cer, "wer": wer, "lang_detected": det, "transcript": hyp}
        return out

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("audio"); ap.add_argument("--lyrics-file"); ap.add_argument("--prompt"); ap.add_argument("--lang"); ap.add_argument("--device", default="cuda")
    a = ap.parse_args()
    lyrics = open(a.lyrics_file, encoding="utf-8").read() if a.lyrics_file else None
    print(json.dumps(Scorer(a.device).score(a.audio, lyrics, a.prompt, a.lang), ensure_ascii=False, indent=1))
