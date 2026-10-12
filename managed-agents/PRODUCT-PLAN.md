# neo-fm cloud product plan (a Technektar product)

Goal: a B2C, India-first AI music product people love, that pays for itself, and that is safe by construction.
This replaces the DGX/HeartMuLa path with Managed Agents (lyrics, pce-poem cascade) + Lyria (audio).

## What users get
- Describe a song in any Indian language -> original, sectioned lyrics (pce-poem cascade) -> sung track (Lyria).
- Raga/tala-aware prompts (Carnatic, Hindustani, folk, devotional, film-style) - the differentiator vs. generic tools.
- Library, share pages (`/s/<id>`), remix/variation, presets (existing app features, unchanged).

## Monetisation (Stripe tiers already in the app)
| Plan | Price | Limits (proposal) | Why |
|---|---|---|---|
| Free | INR 0 | 3 clips/month (<=30s), watermark-labelled | acquisition, no real cost exposure |
| Creator | INR 399/mo | 30 full songs/month | healthy margin at ~INR 7-20 render cost |
| Pro | INR 1,499/mo | 150 full songs/month + stems + API | power users, studios |
Add-ons later: credit packs (top-up renders), commercial-use licence, karaoke/stems exports.

**Unit economics - must be measured before launch.** Secondary sources put Lyria around USD 0.04 (clip) to 0.08 (full)
per track; our ledger assumes GBP 0.05 / 0.25 (deliberately conservative). Claude cost per song (measured via
`usage` on session events): free tier is Haiku-only (~cents); pro adds Sonnet + one Opus polish. Target gross margin >= 70%.
Existing DB quotas (free 3 / creator 100 / pro 1000 songs per month) are **too generous for paid Lyria renders** -
retune in `user_tier_quota()` once real cost per full song is measured.

## Ethics, safety, security (what is enforced in code)
- Content gate before any job and again before any paid call: deterministic rules + Haiku moderator, fails closed
  (`apps/web/lib/safety`, tests in `tests/safety.test.ts`).
- No voice cloning / artist imitation / copyrighted-lyric reproduction (blocked in rules, moderator, and agent prompts).
- AI labelling: UI + `/trust`; audio carries Google's SynthID (per Google). TODO: visible "AI-generated" badge on share pages
  and embed in exported file metadata.
- Spend safety: atomic `reserve_spend` ledger (Lyria), per-tier render caps, per-session outcome iteration caps.
- Secrets: server-only env vars; Gemini key never enters the agent sandbox (custom-tool host side); Managed Agent
  environment has no web tools and `limited` networking.
- Admin/worker endpoints require `CRON_SECRET`; Supabase RLS on all new tables (service role only).
- TODO before public launch: rate limiting per IP/user on `/api/songs` (Upstash is already in the CSP), abuse reporting
  queue + takedown SLA, privacy policy/ToS (India DPDP Act 2023 consent + deletion), age gate (13+/18+ per counsel),
  moderation audit log, red-team eval set for the safety layer.

## Innovation roadmap
1. Full-fidelity pce engine (see `managed-agents/FIDELITY.md`) so lyric quality is measurably better than a single LLM call.
2. "Song from a memory": voice-note/photo -> brief (with consent), Indic-language-first UX.
3. Collaborative remix with credit/royalty-free "inspired by" attribution chains.
4. Creator marketplace for presets (ragas, moods) with revenue share.

## Launch checklist (neo-fm.com)
1. Vercel: add `neo-fm.com` + `www` to project `neo-fm-web` (Production) only after the cloud pipeline passes the
   e2e demo; DNS: `A 76.76.21.21` for apex, `CNAME cname.vercel-dns.com` for www.
2. Supabase: create prod branch/project for cloud pipeline; apply migrations; set service-role key in Vercel Production.
3. Stripe live keys + webhook; `STRIPE_PRICE_*`.
4. Upgrade Vercel to Pro (cron every minute, longer function time) or trigger the worker from `/api/songs`.
5. Rotate every key shared during development.

## Verified status (dev project `neo-fm-dev`, Vercel preview of `claude/sleepy-keller-8eiz4s`)
End-to-end runs through Managed Agents + Lyria, worker driven by `/api/agent/tick`:

| Job | Tier / agent | Language / style | Result |
|---|---|---|---|
| 1 | free (Haiku, K=3) | Hindi / hindustani | Hindi lyrics + title saved, Lyria 3 clip 30.7s stereo 44.1kHz MP3 (ffprobe-verified), 1 render |
| 2 | free | Kannada / kannada-folk | Kannada lyrics + title saved, 1 render |
| 3 | pro (Sonnet + Haiku drafters + Opus polish) | Tamil / tamil-folk | Tamil lyrics + title saved, clip then Lyria 3.5 full = **170.0s** stereo MP3 (ffprobe-verified), 2 renders |

Estimated Lyria spend in the ledger after all three: GBP 0.40 of the GBP 3 cap (estimates; true cost TBD from AI Studio billing).

### Findings that must not be lost
1. **Next.js caches `fetch` GETs on Vercel (persistent data cache).** Supabase-js and the Anthropic SDK both use `fetch`, so a worker saw stale rows
   and truncated event lists (run lookup returned null, job re-finalized forever, queued jobs never claimed). Server clients that must read live state
   now pass `cache: "no-store"` (`apps/web/lib/agent/adapters.ts`). Apply the same to any future server-side reader.
2. **Duration is not controlled.** Asking for 60s produced 170s from Lyria 3.5. Cost and UX both depend on length; add duration steering to the style
   prompt and enforce the clip/full policy per tier before launch.
3. **Always count renders in the database** (`claim_render`, migration 0052), never from a read-modify-write in code.
4. **Worker cadence:** Vercel Hobby cron is daily. Per-minute cron or in-request triggering needs a plan upgrade (Pro) and `maxDuration` >= 60s.
5. Agent session `list_cost` is returned by the Sessions API; log it per job to keep real per-song COGS.

### Cleanup before sharing the preview
- Delete the throwaway Vercel env var `AGENT_TICK_SECRET` (Preview, this branch) and the dev test user `agent-test@neo-fm.invalid`.
- Rotate any key that was ever pasted into chat or a screenshot.
