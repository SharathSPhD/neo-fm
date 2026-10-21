# Audio reward stack: Arena preference head on CLAP + Audiobox aesthetics

Scoring itself (`score_audio.py`) is already on main (#426). This adds an MLP Bradley-Terry head and its feature cache script,
as a competitor to #426's CLAP-only logistic regression (`pref_model.py`).

- `embed_arena.py`: CLAP embedding (3 x 10 s windows) + Audiobox CE/CU/PC/PQ for every Arena clip with a clear A/B winner. The `user_pseudonym`
  field is never read. Features go to `data/` (gitignored); audio and embeddings are not committed.
- `train_pref_head.py`: score = MLP([CLAP 512, aesthetics 4]); P(A beats B) = sigmoid(sA - sB). 80/20 split **by prompt** (hash), so no prompt
  is in both train and held-out. `--no-aes` is the CLAP-only ablation.

## Numbers (run 2026-10-21, RTX 5090, no paid API)
Music Arena (CC-BY-4.0): 8,117 battle files, 3,660 clear-winner A/B battles with both clips present, 7,320 clips.
Prompt-level split: 2,934 train / 726 held-out battles. 95% binomial interval on 726 battles is about +/-3.5 points.

| scorer (held-out pairwise accuracy) | acc |
|---|---|
| random | 50.0% |
| Audiobox PQ only | 58.8% |
| Audiobox aesthetics sum (CE+CU+PC+PQ) | 60.9% |
| MLP on CLAP only (this repo, `--no-aes`) | 58.7% |
| #426 CLAP logistic regression (5-fold GroupKFold by prompt, different split) | 61.5% |
| **MLP on CLAP + aesthetics (3 seeds)** | **63.5%, 64.9%, 63.9% (mean 64.1%)** |

Reading: aesthetics add about 5 points on top of CLAP alone (58.7 to about 64). The combined head sits 2-3 points above the aesthetics-sum baseline and
#426's CLAP-only regression, but that is inside the interval, so treat it as "slightly better, not proven". An earlier battle-level split gave 65.0%,
which leaks prompts (many Arena prompts are pre-baked and repeat), so the prompt-level numbers above are the ones to quote.
Arena votes are noisy; around 64% is a modest reward signal and should be used as one term with the lyric and diction metrics, not on its own.

Setup notes (torch 2.11 cu128): torchaudio's loader needs torchcodec and faster-whisper's PyAV decode breaks on PyAV 19, so audio is decoded with librosa.
The `laion-clap` pip package is not used (it pins numpy 1.x); CLAP weights are loaded through transformers.
