# neo-fm

India-first, composition-aware AI music platform.

A Next.js + Supabase web app talks to a fleet of Docker services on an NVIDIA DGX Spark over Tailscale:

- **music-inference** — HeartMuLa instrumental + lyrical generation.
- **dgx-worker** — pgmq poller that orchestrates jobs end-to-end.
- **vocal-synth** *(Phase 7)* — svara-TTS Indic vocals layered on top of HeartMuLa instrumental.

Built phase-gated with real artifacts and demo evidence at every step.

## Read this first

- [docs/SPEC.md](docs/SPEC.md) — technical specification (architecture, contracts, data model, TRIZ).
- [docs/PRD.md](docs/PRD.md) — product requirements (personas, journeys, scope ladder).
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) — task-level plan, phase by phase.
- [docs/DECISIONS/](docs/DECISIONS/) — ADRs.
- [AGENTS.md](AGENTS.md) — rules for any agent (human or AI) working in this repo.

## Phase status

- Phase 0 — Bootstrap (**done**)
- Phase 1 — music-inference vertical slice (**code merged**; WAV demo blocked on DGX bring-up — see [`demos/phase-1-SMOKE-HANDOFF.md`](demos/phase-1-SMOKE-HANDOFF.md))
- Phase 2 — Song Document DSL + Western co-composer (**done**; golden request committed; WAV blocked on DGX — see [`demos/phase-2-SMOKE-HANDOFF.md`](demos/phase-2-SMOKE-HANDOFF.md))
- Phase 3 — Public lyrics provider + Pratyabhijna seam (**done**; 12-entry PD corpus + golden request committed; WAV blocked on DGX — see [`demos/phase-3-SMOKE-HANDOFF.md`](demos/phase-3-SMOKE-HANDOFF.md))
- Phase 4 — Supabase schema + cloud API + worker (**blocked on operator**; see [`docs/PHASE-4-HANDOFF.md`](docs/PHASE-4-HANDOFF.md))
- Phase 5 — Web UI (pending)
- Phase 6 — Carnatic + Hindustani + Kannada-folk modules (pending)
- Phase 7 — Indic phonetics + svara-TTS vocal layer (pending)
- Phase 8 — GPU-share governor (pending)
- Phase 9 — PWA polish, notifications, quotas (pending)
- Phase 10 — Pratyabhijna integration (pending)
- Phase 11 — Observability (pending)
- Phase 12 — Managed-API pro tier (deferred, post-v1)

## Local development

```sh
corepack enable && corepack prepare pnpm@9 --activate
pnpm install
pnpm -r typecheck

uv run --project services/music-inference \
  uvicorn app.serve:app --host 0.0.0.0 --port 8000

curl localhost:8000/healthz
```

## License

Apache-2.0 — see [LICENSE](LICENSE).
