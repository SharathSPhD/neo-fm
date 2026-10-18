# Handoff: quality / diction / Indic prosody

## State
- **#105** (QUALITY-REPORT): 60 s full-length-lyrics results. Bengali 93 (mean 77, bn-10 fails at 37), Hindi 92/93, Kannada 91/92, Tamil 96/95, Telugu 96/96.
- **#106** (synced lyrics): `lib/lyrics/sync.ts` matches heard lines to paced lines by text; embed player gets `lineTimings`. Needs `agent_runs.line_timings` (migration 0077) and a lead-run backfill for old songs.
- **#107** (diction gate, shadow): `lib/diction/gate.ts`, wired in `lib/agent/process.ts` `qaDiction`. `DICTION_GATE=off` disables. Verdicts are stored in `diction_qa` and counted in the health summary. Enforcement is not built.
- **#113** (polish candidate, NOT live): `managed-agents/candidates/polish-tail-safe.md`, analysis in `managed-agents/PCE-MISS-ANALYSIS.md`.
- Merged earlier: te/ta diction regression fixtures (#55), Kannada/prosody docs.

## Run and verify locally
- `cd apps/web && pnpm install && pnpm vitest run tests/diction-gate.test.ts tests/diction-regression-te-ta.test.ts tests/lib/lyrics-sync.test.ts`
- Text A/B of the candidate: `npx tsx scripts/quality/polish-ab.mts --per-language 4 --out <file>` (needs a working Anthropic key and `GEMINI_API_KEY`; the key in the last session returned 401).
- Raw data: `managed-agents/quality/*.jsonl`, `line-features.json`; audio in `/mnt/project-files/quality/`.

## Open risks
- Gate thresholds were tuned on 65 scores (1 rerender, 5 flagged); N is small.
- Misses are mostly the unsung final 1-2 lines (length budget), not phonetics. The candidate fix is unmeasured.
- Line timings are measured on sung lyrics and matched by text; heavy hook repeats can still mis-match.
- No native-speaker scoring of the 18-clip prosody packet yet.

## Next 3 steps
1. Merge #105-#107, apply 0077, run the line-timings backfill.
2. Run the candidate through the prod eval gate (EVAL-PCE.md); only then consider a live change.
3. After a shadow week of `diction_qa.verdict`, decide on enforcement (hold or auto re-render) with a native-reviewer check.
