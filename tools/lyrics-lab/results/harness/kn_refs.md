# Kannada refs pool: free analysis (2026-10-21, no API calls)

Script: `tools/lyrics-lab/harness/kn_refs_analysis.py`. It replays the harness's deterministic exemplar retrieval (k=3) for the 12 Kannada briefs of the Opus+refs vs live-polish judging, and joins each brief's judged margin (mean of Claude and Gemini total_diff). It then scores the kn exemplars and the 129 PD-verse shortlist rows with the deterministic lyric metrics.

## Which refs drive the wins?
- The pool has 31 kn exemplars; only 14 were ever retrieved for these 12 briefs, 17 never were.
- Mean margin by exemplar is flat (about 5 to 7) for every exemplar retrieved 3 or more times. Two single-use ones are outliers (kn-3c9770dd79: 9, kn-75e078fe52: 0.25), which one brief each cannot support.
- Exemplar det score vs margin: Pearson 0.45 on the 6 exemplars with 3+ retrievals. Not usable at n=6.
- Conclusion: 12 briefs cannot say which refs matter. Margins are dominated by the brief. No safe pruning from this data; do not drop exemplars on this evidence.

## Are PD verse units usable as refs?
- Exemplars (Claude-judged written songs): mean det 88.7. PD shortlist: mean det 52.0 (vachanas 53.7, Kanaka Dasa 51.7, Nagachandra 50.5). 80 of 129 are tier B (edition review pending).
- The PD units are devotional verse with different structure from the song form the harness writes, so they are poor drop-in refs for song briefs. They fit better as diction or imagery material than as structural exemplars. Tier B stays references-only until the licence review.

## What would settle pruning
Log the retrieved exemplar ids per run (the trace currently stores only "3 exemplars"), then a paired comparison per exemplar subset on many briefs. That needs paid judging, so it would need a tap card and a head-to-head design.

## Logging added
The harness now records which exemplar ids rode along: refsContext returns `ids`, the harness trace shows `context: 3 exemplars [ids]`, the probe returns `exemplar_ids`, and production polish logs `refs lang=.. ids=..` in the run trace. Pruning data accrues for free; the paired per-subset head-to-head is parked until enough logged runs exist.
