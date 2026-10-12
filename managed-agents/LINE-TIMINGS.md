# Line-level lyric timestamps (synced lyrics)

**What:** for a finished song, `alignLines` (`apps/web/lib/diction/timestamps.ts`) maps each lyric line to start/end seconds, by asking Gemini for timed sung segments (`transcribeTimed`, ~1 audio call, same cost class as diction QA) and aligning them to the lyric lines by character error rate. No Lyria render.

## Data shape (what the song-page UI consumes)
```json
{ "version": 1, "duration_s": 30, "source": "gemini-3.8-flash",
  "lines": [ { "i": 0, "text": "…", "start_s": 0.0, "end_s": 5.0, "sung": true } ] }
```
- `lines` are in lyric order, section tags/blank lines removed (same filter as diction QA), timeline monotonic.
- `sung:false` = the singer never reached the line (clip ran out, see QUALITY-REPORT); times are interpolated so scrolling still works; the UI may dim it.
- Highlight rule: active line = last line with `start_s <= currentTime`.
- Build it with `toPayload(alignLines(lines, segments, durationS), durationS)`; sample output: `managed-agents/quality/line-timings-sample.json`.

## Accuracy check (18 stored review clips)
All 18 aligned with every line matched and monotonic. Spot check on 6 songs / 31 lines: cutting the audio at each line's `[start-0.3 s, end+0.3 s]` and re-transcribing gave mean CER 0.08 against the intended line, 30 of 31 under 0.4 (the outlier also contained the previous line's tail). Resolution is about 1 s, because Gemini reports whole or half seconds; fine for line-level karaoke, not for word-level.
Failure modes seen: an occasional empty/unparseable reply (the sample script retries once; production should too), and long songs untested (only 30 s clips so far).

## Storage (proposed, not pushed)
Add `agent_runs.line_timings jsonb` (nullable) via migration **0077** (assigned by the lead; the migration file is not in this PR):
```sql
alter table public.agent_runs add column if not exists line_timings jsonb;
```
Compute after `qaDiction` in the same best-effort path (never fail a job on it), and backfill finished songs with a one-off that downloads `tracks/<audio_path>` and runs the same two calls. `apps/web/lib/agent/*` is the lead's, so that wiring is left to them; this PR only adds the library, tests and docs.
