# arena: shared evaluation for lyrics and song pipelines

One benchmark every lyrics and song change has to win on. Stdlib Python only; nothing here is imported by the web app.

## How it works
- **Entries**: each pipeline variant writes one JSON of outputs over a fixed brief set (`data/entries/lyrics/<variant>.json` = `{brief_id: lyric}`; songs = `{brief_id: {audio, scores, usd}}`). Briefs: `data/briefs/lyrics.json` (the lab's 40 briefs plus 8 Bengali, per language and tier) and `songs.json` (same briefs; render a subset, the song threads choose).
- **Lyrics battles**: blind Claude judge (`claude-sonnet-5-5`, six-dimension rubric from the lab), every pair judged in both orders and merged (summed difference >= 1 = win, else tie). Position bias is reported and cancels.
- **Song battles**: scorers give each song numbers (`gemini_audio`, `sung_word_acc`, `audio_quality`, `text_audio_match`, `music_arena_pref`); they are scaled, blended with `data/song-weights.json`, compared on shared scorers only, and ties fall inside a margin. Direct Gemini pairwise verdicts can be added with `songs.ingest_pairwise`.
- **Ranking**: Bradley-Terry on all battles, shown on an Elo scale with a 95% interval from resampling whole briefs. "Beats reference" is only claimed when intervals do not overlap. Cost per item comes from `costs.jsonl`.
- Rule from the lab: `det` (metre/rhyme score) alone was gamed. Report judge win rate first; never rank on a proxy.

## Use
```sh
cd tools/arena
python3 -m arena register my-variant --kind lyrics --label "my change" --owner <thread>
# put outputs in data/entries/lyrics/my-variant.json, then:
python3 -m arena jobs my-variant lab-g0-oneshot --out /tmp/jobs.json   # prints the USD ceiling, no spend
# send jobs.json to POST /api/admin/lyrics-teacher (or `python3 -m arena run ... --hard-stop-usd N`), then:
python3 -m arena ingest my-variant lab-g0-oneshot results.json
python3 -m arena cost my-variant hi-1 0.012          # per generated item
python3 -m arena songs song-variant-a song-variant-b # after scorers fill entries
python3 -m arena report --kind lyrics --judge-prefix claude-sonnet
python3 -m arena page --lyrics-judge-prefix claude-sonnet   # out/leaderboard.html
python3 -m unittest discover -s tests
```
`seed-prod <prod-40.json>` imports the PCE thread's production baseline (the reference variant, USD 0.09/song). `seed-lab <path-to-lyrics-lab>` imports the lab's already-paid judgments (G0 to G3, Gemini and one Claude round) so the board starts with real battles.

## Spend protocol
Judging a pair of variants over 40 briefs is 80 calls, ceiling about USD 0.75 at list price. Estimates beat the route meter, which undercounts. Ask S with a tap card naming the pair and the ceiling; run with a hard stop; log in `lab/spend.md`.
