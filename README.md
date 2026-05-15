# neo-fm

India-first, composition-aware AI music platform.

A Next.js + Supabase web app talks to a fleet of Docker services on an NVIDIA DGX Spark. The DGX is **outbound-only** — it polls Supabase for jobs and uploads results; cloud never reaches into DGX. See [`docs/SPEC.md`](docs/SPEC.md) §2.1 for the trust boundary.

> **End-to-end is live.** A real job (`ce972419-60fc-40a7-b2d5-10287e465a15`) has closed the loop in ~39s on production Supabase + DGX. WAVs (`demos/phase-{1,2,3}.wav`) are committed. The web UI is auto-deployed to Vercel production on every push to `main`.

- **music-inference** — HeartMuLa instrumental + lyrical generation.
- **dgx-worker** — pgmq poller that orchestrates jobs end-to-end.
- **vocal-synth** *(Phase 7)* — svara-TTS Indic vocals layered on top of HeartMuLa instrumental.

Built phase-gated with real artifacts and demo evidence at every step.

## Read this first

- [docs/SPEC.md](docs/SPEC.md) — technical specification (architecture, contracts, data model, TRIZ).
- [docs/PRD.md](docs/PRD.md) — product requirements (personas, journeys, scope ladder).
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) — task-level plan, phase by phase.
- [docs/DECISIONS/](docs/DECISIONS/) — ADRs (0001-0011 accepted at this revision).
- [AGENTS.md](AGENTS.md) — rules for any agent (human or AI) working in this repo.

## Phase status

- Phase 0 — Bootstrap (**done**)
- Phase 1 — music-inference vertical slice (**done**; real HeartMuLa weights + `demos/phase-1.wav`)
- Phase 2 — Song Document DSL + Western co-composer (**done**; golden request + `demos/phase-2.wav`)
- Phase 3 — Public lyrics provider + Pratyabhijna seam (**done**; 12-entry PD corpus + `demos/phase-3.wav`)
- Phase 4 — Supabase schema + cloud API + worker (**done**; live end-to-end against production Supabase)
- Phase 5 — Web UI (**done**; auto-deployed to Vercel prod on `main` push)
- Phase 6 — Carnatic + Hindustani + Kannada-folk modules (active backlog)
- Phase 7 — Indic phonetics + svara-TTS vocal layer (ADR 0010 accepted; ready to build)
- Phase 8 — GPU-share governor (ADR 0011 accepted; ready to build)
- Phase 9 — PWA polish, notifications, quotas (partial — DB quotas live; PWA + email pending)
- Phase 10 — Pratyabhijna integration (**out of scope for v1**; `PublicLyricsLibraryProvider` is the v1 lyric source)
- Phase 11 — Observability (active backlog)
- Phase 12 — Managed-API pro tier (deferred, post-v1)

The active v1-finish work plan lives at [`.cursor/plans/neo-fm_v1_finish_*.plan.md`](.cursor/plans/) — it drives Phases 6-9, 11 plus six marketable add-ons (shareable URLs, lyric editor, presets, detail page, section regen, landing page).

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
