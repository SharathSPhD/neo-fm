# Managed Agents pipeline (cloud-only; no DGX)

```
web POST /api/songs -> create_song_job (quota/tier checks, unchanged)
Vercel cron /api/agent/tick -> claim queued job -> Managed Agent session (outcome kickoff)
  agent: pce-poem cascade -> song_document.json -> custom tool generate_music
  tick answers generate_music: spend reserve (public.reserve_spend) -> Lyria -> Storage -> tracks row
```

| Tier (users.tier) | Agent | Models | Cascade | Lyria |
|---|---|---|---|---|
| free | producer-free | Haiku 5.5 | K=3, no revision | 1 call |
| creator / pro / developer | producer-pro | Sonnet 5.5 coordinator, Haiku 5.5 drafters, Opus 5.5 (low effort) polish | K=6 + shadow revision | 2 calls (clip then full) |

Cost levers: Haiku does all bulk drafting; the system prompt + skill are static (cached prefix);
Lyria spend is reserved atomically against `LYRIA_BUDGET_GBP`. Seed/backfill songs should go through
the Messages Batch API (50% off) - not wired yet (see TODO).

## Apply (needs `ant` >= 1.34 and an Anthropic API key)
```sh
cd managed-agents
ant apply --dry-run -v skills/pce-poem environments/neo-fm-cloud.yaml agents/pce-poet.md agents/pce-polisher.md agents/producer-free.md agents/producer-pro.md
# review, then add --yes
```
Copy IDs from `claude-lock.json` into `MA_ENVIRONMENT_ID`, `MA_AGENT_ID_FREE`, `MA_AGENT_ID_PRO`.

## TODO
- Persist lyrics/song_document from session outputs in `finalize()` (columns exist on `agent_runs`).
- Batch API path for bulk/seed songs; prompt-cache verification via `usage.cache_read_input_tokens`.
- Full-fidelity pce engine: see FIDELITY.md.
