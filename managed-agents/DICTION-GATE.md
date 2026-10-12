# Diction gate: catching a bad render automatically

Status: shadow mode only. The gate records a verdict on every scored song; nothing the user sees changes. Turning it into a re-render or a hold is a prod behaviour change and goes through the eval gate (below).

## What it does
After a song is rendered, `qaDiction` (apps/web/lib/agent/process.ts) has Gemini transcribe the audio and scores it against the sung lines. `apps/web/lib/diction/gate.ts` turns that into a verdict, stored in `agent_runs.diction_qa` (JSON, no migration) as `verdict`, `unorderedPct`, `reasons`, `reordered`, `tailUnsung`:

| Verdict | Rule (on the order-free score U) | Meaning |
|---|---|---|
| `rerender` | U < 60 | most of the song does not match the lyrics |
| `review` | 60 <= U < 80, or the last 2+ lines were never heard | something is off; look before presenting it as finished |
| `pass` | otherwise | |

`reordered` is informational: Lyria sometimes sings sections in a different order, which is a structure deviation and not a diction failure, so it is not gated. `DICTION_GATE=off` disables the verdict. `/api/admin/health-summary` now reports `diction_gate` counts (`pass/review/rerender/ungated`).

Two fixes ride along in the same function: the audit now scores the *sung* lines only (`singableLines`), because a section header such as "Pallavi:" counted as a line scored as a miss (the same bug that made te-16 read 66 instead of 97); and the ordered `matchPct` is stored unchanged so existing dashboards keep their meaning.

## Tuning (no new renders)
Scored on all 65 transcripts already collected (50 clips at 30 s, 15 songs at 60 s with full lyrics), order-free score U:

- Sorted U values: 58, 63, 68, 79, 79, 81, 86, 88, 91, 91, 92, ... up to 100 (median 98).
- `rerender` (U < 60): 1/65 (te-11, 58; two closing lines never sung).
- `review` (60 <= U < 80): 4/65 more: hi-16 (63), bn-10 (68), bn-14 (79), te-14 (79). Together 5/65 = 7.7% of songs need a look.
- 81 and above pass, including the Kannada 88 and 91 songs (one soft line each).
- bn-10 is the Bengali failure from the 60 s run: 37 in order, **68 order-free**. The scrambled order accounts for about 30 points, so the order-free score is the fairer gate input, but 68 is still a real failure and lands in `review`. (An earlier note in the quality report said order-free scoring does not rescue bn-10; it rescues it partly, to 68, not to a pass.)
- Why 80 and 60: 60 is the failure line the quality report already uses; 80 sits in the gap between the 79 cluster and 81+, so the review queue is the bottom ~8%. Moving it to 85 would add 2 songs (kn-1 86, ta-15 88-ish) of the 65; to 75 would drop two.

Caveats: N=65 internal renders from one transcriber, no native-speaker ground truth for "bad", and the lyrics were all from one pipeline config. The thresholds are a starting point for the shadow run, not a measured error rate.

## Eval gate before it can change behaviour
1. **Shadow (now):** collect verdicts on live songs for a week. Watch the `diction_gate` counts and the review rate by language; a rate far above ~8% means the thresholds or the transcriber are off, not the singers.
2. **Check against people:** sample `review`/`rerender` and `pass` songs for the native-reviewer packet (managed-agents/QUALITY-REPORT.md) or the blind AI-judge, and confirm the flagged ones are worse. Gate: flagged songs score lower on the judge/native scale by a clear margin, and fewer than ~1 in 10 flagged songs are judged fine.
3. **Enforce (lead's decision, behind a flag):** `review` => show the song with a "we're checking this one" hold or queue for the review kit; `rerender` => one automatic re-render (costs one more Lyria call, so cap it at one per song and count it against the user's and global spend caps). Tail-truncation songs (clip ran out) are better fixed by the clip-length budget experiment than by re-rendering.

Not built yet: the enforcement action itself (status hold or re-render trigger), because it changes what users see and spends money. It belongs in `apps/web/lib/agent` and needs the lead.
