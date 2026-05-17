# Sprint 0 — preflight ralph evidence

Status: PASS
Date: 2026-05-17
Commit: pending (this sprint)
Worktree: `/home/sharaths/projects/neo-fm-worktrees/v1.4-deep-dive`
Branch: `v1.4-deep-dive` off `main@d124f4c`

## What shipped

- Persisted DGX-Spark GB10 compute rule via Serena memory (`dgx-spark-compute-rule`).
- AGENTS.md updated: new `## Compute rule (v1.4+)` section + corrected git identity (`qbz506@york.ac.uk`) and model list.
- `.gitignore` now ignores `review/` and `.serena/`.
- Worktree created at `/home/sharaths/projects/neo-fm-worktrees/v1.4-deep-dive` on new branch `v1.4-deep-dive`.
- ADR 0023 written (local, `docs/` gitignored) synthesising the four review documents into a single architecture decision.
- Demo evidence template at `demos/v1.4/_template/ralph-evidence.md`.
- Stale local-only files dropped: `neo-fm_music_platform_06aedd70.plan.md`, `project-research.md`.

## Files touched

```
.gitignore                                                  modified
AGENTS.md                                                   modified
docs/DECISIONS/0023-audio-stack-vnext.md                    added (local)
demos/v1.4/_template/ralph-evidence.md                      added
demos/v1.4/sprint-0-preflight/ralph-evidence.md             added
neo-fm_music_platform_06aedd70.plan.md                      deleted
project-research.md                                         deleted
```

## DGX environment audit

| check | result | evidence |
| --- | --- | --- |
| GPU present | PASS | `NVIDIA GB10` visible in `nvidia-smi`, driver 580.142, CUDA 13.0 |
| CUDA toolchain | PASS | `nvcc --version` → `release 13.0` |
| Python | PASS | `python3 --version` → `Python 3.12.3` |
| uv | PASS | `uv 0.11.14 aarch64-unknown-linux-gnu` |
| pnpm | PASS | `9.15.9` |
| node | PASS | `v20.18.2` |
| docker | PASS | `Docker version 29.2.1` |
| hf cli | PASS | `hf` at `/home/sharaths/.local/bin/hf`; whoami → `qbz506` |

DGX-side ML library audit (NeMo, AudioCraft, stable-audio-tools, peft, transformers, MFA, WhisperX) deferred to the sprint that first needs each library — Sprint 7 (transformers + peft for IndicBART), Sprint 8 (MFA + WhisperX for bhavageete alignment), Sprint 10 (AudioCraft), Sprint 11 (stable-audio-tools), Sprint 13 (NeMo). Each sprint's first task is the `pip install` / `uv add` it needs, captured in that sprint's evidence file.

## Baseline test counts on the v1.4 worktree

| stack | tests | result |
| --- | --- | --- |
| TS (`pnpm test`) | 263 | 263/263 PASS |
| - song-doc | 18 | PASS |
| - g2p | 27 | PASS |
| - co-composer | 67 | PASS |
| - lyrics | 24 | PASS |
| - style-presets | 7 | PASS |
| - web | 120 | PASS |
| Python (`uv run pytest`) | 123 + 1 skipped | 123/123 PASS |
| - music-inference | 26 | PASS |
| - vocal-synth | 36 | PASS |
| - cover-art-synth | 14 | PASS |
| - dgx-worker | 47 + 1 skipped | PASS |

## Notable decisions

- ADR 0023 chose R3's hybrid layered stack over R1's unified foundation model. v1.4 ships in weeks, not months, and the hybrid stack matches the existing code.
- Personal-rule MCP (`manage_personal_rules`) not available in this environment; used Serena `write_memory` + AGENTS.md update instead. Both surfaces are durable across sessions.
- `.serena/` added to `.gitignore` so Serena project state stays local (mirrors `.cursor/`).
- `move_agent_to_root` couldn't resolve the worktree path; operating via absolute paths is fine.
