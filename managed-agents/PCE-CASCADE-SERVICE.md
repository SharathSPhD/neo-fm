# PCE cascade service (host-side cascade)

Runs the vendored Pratyabhijna engine (`managed-agents/pce-engine/run_cascade.py`, unmodified) behind `POST /cascade`, so the
host can drive the cascade with parallel Haiku calls instead of a Managed Agents sandbox session. Why: the agent draft is ~80%
of a Pro song's wall clock (job_telemetry.stages_ms). Code: `services/pce-cascade`, `apps/web/lib/cascade`.

Off by default. Nothing here changes production until all of the following, which are S-owned and wait for the eval gate:

1. Deploy. The Dockerfile copies the engine, so build from the repo root: `docker build -f services/pce-cascade/Dockerfile -t <image> .`
   (or Cloud Build with the same file), push, then `gcloud run deploy neo-fm-pce-cascade --image <image> --region asia-south1
   --memory 1Gi --concurrency 4 --timeout 60 --set-env-vars CASCADE_TOKEN=<new secret>`.
2. Vercel env: `PCE_CASCADE_URL` (https service URL), `PCE_CASCADE_TOKEN` (same secret).
3. Canary one account first: `update users set agent_plan = 'host' where id = '<id>'`. Compare `job_telemetry.metrics.plan = 'host'`
   stages_ms (`agent_draft` now covers plan + drafts + scoring + revisions + title) against `pro`.
4. Everyone paid: `PRO_AGENT_VARIANT=host`. Unset it to roll back; free tier is never affected.

Knobs: `CASCADE_K` (default 4). Models: Haiku for plan, drafts, revisions and title/style (`HOST_MODELS` in `host-cascade.ts`).
The host Sonnet polish and the Lyria path are the same code as the agent path. The engine needs `EMBED_URL`/`EMBED_TOKEN`
per request (a job-scoped token is passed in the body); without them it degrades to the lexical embedder, as before.

Not yet measured: song quality (needs the eval gate; Haiku drafts replace Haiku poet drafts, but the coordinator's
instructions per candidate are now the engine's prompts plus a short style/length preamble) and the end-to-end time.
