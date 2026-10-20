# Audio preference model and pool scorers (run 2026-10-20, RTX 5090, no paid API)

## Preference model (Music Arena, CC-BY-4.0)
- Data: full download, 8,117 battle files; 3,660 decisive A/B battles with both clips present (1,870 vocal, 1,790 instrumental). Ties and both-bad dropped.
- Model: CLAP (laion/larger_clap_music) audio embedding, 3 x 10 s windows; Bradley-Terry logistic regression on emb_A - emb_B, trained on both orderings so it cannot learn the A/B position bias.
- Held-out: 5-fold CV with whole prompts held out (GroupKFold), so no prompt is in both train and test. Majority baseline 52.4%.

| C | all | vocal | instrumental |
|---|---|---|---|
| 0.1 | 54.8% | 55.7% | 53.9% |
| 1 | 57.5% | 57.5% | 57.5% |
| 10 | 60.6% | 59.6% | 61.7% |
| 100 | **61.5%** | 59.1% | 64.1% |

Caveats: C was picked on the same folds, so 61.5% is a little optimistic; Arena votes are noisy and a ~60% ceiling is typical for a linear probe on one embedding. First pass on 3,295 battles gave 60.0%, so the extra shards moved it little. This is weak as a reward on its own; use it only as one signal next to the quality scorer. Not tested on Indian-language vocals specifically (Arena is mostly English prompts).

## Pool songs (public r2.dev CDN URLs from the public queue API)
178 of 179 scored (1 failed), 9 Indian languages plus 7 untagged ("zxx") and 4 English. Scorers: Audiobox aesthetics (CC-BY-4.0), CLAP text-audio match, faster-whisper large-v3 (MIT). Reference lyrics were NOT available: prod table read was denied and the public /t/<id> pages do not render lyrics, so the sung-word check is reference-free (language match, native-script share, word rate, distinct-word ratio), not CER.

| lang | n | PQ | CE | CU | PC | Whisper lang match | script share | distinct words |
|---|---|---|---|---|---|---|---|---|
| hi | 25 | 8.05 | 7.32 | 7.51 | 6.63 | 100% | 1.00 | 0.72 |
| ta | 23 | 8.14 | 7.41 | 7.49 | 6.52 | 100% | 1.00 | 0.58 |
| kn | 22 | 8.17 | 7.41 | 7.53 | 6.29 | 100% | 1.00 | 0.61 |
| te | 20 | 8.20 | 7.39 | 7.53 | 6.50 | 100% | 1.00 | 0.64 |
| bn | 17 | 8.14 | 7.34 | 7.58 | 6.58 | 100% | 1.00 | 0.72 |
| gu | 16 | 8.01 | 7.27 | 7.46 | 6.60 | 100% | 1.00 | 0.52 |
| pa | 16 | 8.06 | 7.24 | 7.56 | 6.65 | 100% | 1.00 | 0.64 |
| mr | 15 | 8.03 | 7.28 | 7.43 | 6.61 | 100% | 1.00 | 0.73 |
| ml | 13 | 8.15 | 7.34 | 7.50 | 6.39 | 100% | **0.11** | 0.66 |
| zxx | 7 | 7.88 | 7.53 | 7.79 | 5.61 | 0% | - | 0.57 |
| en | 4 | 8.14 | 7.54 | 7.76 | 6.20 | 100% | 1.00 | 0.75 |

Overall Whisper language match 96.1%. Findings:
- Audio quality is uniform across languages (PQ 7.9-8.2), so quality does not separate the languages; the sung-word signal is where they differ.
- Malayalam: Whisper detects Malayalam but the transcript is mostly not Malayalam script (script share 0.11). Likely a Whisper large-v3 weakness on sung Malayalam, so treat Malayalam intelligibility as unmeasured rather than bad.
- The 7 "zxx" tracks have almost no transcribed words (instrumental or no language), expected.
- CLAP text-audio similarity averages about 0.00 because the prompt is the track title plus tags, often native-script; CLAP's text tower is English-trained. Use English style prompts for this scorer.
- Words per second is low everywhere (0.14-0.29) because Whisper VAD drops sung sections; do not use it as an accuracy number.
- The Arena preference score (applied to pool songs) is nearly flat across languages and not informative at this model strength.

Reproduce: tools/lyrics-lab/audio/{score_pool.py, pref_model.py, pool_report.py}; outputs in runs/pool-scores/ and runs/pref-model/ on the 5090 (uncommitted, untracked).
