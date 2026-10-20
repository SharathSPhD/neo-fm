# lyrics-lab tooling

Research and training tooling for the lyric-quality upgrade (findings: shared folder `lyrics-lab/`, not in this repo).
- `bench/`: LyricBench-5 briefs, deterministic metre/rhyme scorer (`lyricmetrics.py`), pairwise judge harness.
- `corpus/`: licence-clean text corpus builders (Wikisource dumps, repo public-domain lyrics) with a provenance manifest.
- `train/`: QLoRA SFT and DPO on a local GPU; preference-pair generation and evaluation.
Nothing here is imported by the web app. Hard rules: no copyrighted lyrics in training data, no voice cloning, no artist imitation (AGENTS.md).
