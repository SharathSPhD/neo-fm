# Audio reward stack (open licences only)

Scoring: Audiobox Aesthetics (CC-BY-4.0), CLAP `laion/larger_clap_music` via transformers (Apache-2.0), faster-whisper large-v3 (MIT).
No NC models (SongEval, MusicEval, MuQ). `laion-clap` pip package is not used: it pins numpy 1.x and would break the training venv.

- `score_audio.py`: one file -> aesthetics (CE, CU, PC, PQ), CLAP text similarity, Whisper CER/WER vs intended lyrics. Verified on one clip.
- `embed_arena.py` / `train_pref_head.py`: cache features for Music Arena clips and fit a Bradley-Terry head with a battle-level held-out split.
  **Not yet run**: see status below.
- `fetch_pool.py`: polite public-page fetch of neo-fm pool songs for calibration. **Not yet run.**

Notes from setup on the 5090 (torch 2.11 cu128): torchaudio's loader needs torchcodec and faster-whisper's PyAV decode breaks on PyAV 19,
so audio is decoded with librosa and handed to both models as arrays.

Audio and embeddings live under `data/` (gitignored); only scripts and numbers are committed.

## Status
Results table: pending (Arena download was ~9% of 25 GB, 13,090 mp3, 8,117 battle JSONs when work paused).
