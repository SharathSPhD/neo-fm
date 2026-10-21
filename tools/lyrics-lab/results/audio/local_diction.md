# Local diction scorer vs Gemini (qaDiction), 2026-10-21

Setup: `local_diction_asr.py` (faster-whisper large-v3, int8, CPU) transcribes the sung audio, then `score_transcripts.mjs` scores it with the production `gateTranscript` (same scorer as Gemini qaDiction, only the transcript source differs). Data: the 24 Gemini-scored ta/te/kn renders in lab/render-harness/validation (no Gemini transcripts were stored, only unordered %). Free, no paid calls.

## Result: not a drop-in replacement
- Default run (VAD on): 14 of 24 transcripts empty or near empty (Whisper's voice filter drops sung vocals over music). Pearson vs Gemini -0.14, Spearman 0.36. Do not use VAD on songs: `ASR_VAD=0`.
- VAD off, 6 clips (3 stock native, 3 Claude-romanized): local unordered % vs Gemini:

| clip | arm | Gemini | local |
|---|---|---|---|
| e3-ta-a-1 | stock | 64 | 88 |
| e3-te-a-1 | stock | 64 | 77 |
| e6-kn-stock-1 | stock | 63 | 84 |
| e5-ta-rom-1 | romanized | 95 | 78 |
| e5-te-rom-2 | romanized | 100 | 78 |
| e6-kn-rom-1 | romanized | 97 | 60 |

Whisper ranks stock above romanized, the opposite of Gemini (and of what the 6 stock vs 6 romanized gap showed: ~65 vs ~97). Whisper's language prior writes plausible native text even when the singing is off (lenient on stock), and misses sung Latin-input renders. With 6 clips, no ground truth for which is right, and stock Whisper only, this says: the open ASR does not reproduce the Gemini ordering, so it cannot replace Gemini for ranking romanization arms.

## Full run, VAD off, all 24 renders (final)
Pearson -0.23, Spearman -0.03 against Gemini. Mean unordered %, Gemini vs local:

| lang | arm | n | Gemini | local |
|---|---|---|---|---|
| kn | stock | 2 | 62 | 82 |
| kn | romanized | 2 | 98 | 69 |
| ta | stock | 5 | 67 | 83 |
| ta | romanized | 5 | 97 | 67 |
| te | stock | 5 | 66 | 69 |
| te | romanized | 5 | 97 | 67 |

Whisper large-v3 is not a usable stand-in for Gemini on sung Kannada, Tamil or Telugu: it ranks the arms backwards. Keep Gemini transcribeSung for diction judging.

## Next options (not run)
- Indic ASR (Malayalam fine-tune Apache-2.0 for ml; IndicConformer pending HF access) for ml where Whisper writes 0% Malayalam script.
- Human or second-model check on a handful of clips to decide which scorer tracks real diction.
