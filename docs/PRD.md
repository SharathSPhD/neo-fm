# neo-fm — Product Requirements Document

Status: living document. Owners: SharathSPhD.

## 1. Why this exists

Today's "AI song" tools (Lyria 3, Suno, Udio, HeartMuLa stock) treat Hindi and other Indian languages as just-another-prompt-tag. App-store reviews and creator forums show recurring complaints about Indian pronunciation, accent, and tonal authenticity. None of these tools expose **composition structure** — they ship a single prompt box and a single black-box output.

neo-fm targets the gap: **India-first language and pronunciation, composition-first workflow, and zero per-track cost** thanks to on-prem DGX + open-weights HeartMuLa.

## 2. Goals

- Give creators a reliable, India-aware AI music engine with **long, structured songs** comparable to Lyria 3 Pro.
- Provide a transparent, editable Song Document — not just a one-shot prompt.
- Keep DGX available for other workloads (LLM fine-tuning) by capping music GPU share.
- Ship a free tier that is hard for per-track-priced incumbents to match sustainably.
- Stay open: Apache-2.0 repo, open-weights core models, no closed third-party APIs in the hot path.

### 2.1 Non-goals (v1)

- Mobile apps (React Native/Expo) — post-v1.
- Stem export, MIDI export, DAW plugins — post-v1.
- Payment integration — post-v1.
- Public API/MCP exposure — post-v1.

## 3. Personas

- **Indie creator / bedroom producer** — wants fast, authentic Hindi/Kannada/Carnatic/Hindustani songs as a starting point for their own production work.
- **Serious musician / composer** — wants control over structure, raga/tala, instrumentation, and lyrics. Cares about repeatability and editability of the composition layer, not just the audio.
- **Curious general user** — types a prompt, expects something cool, doesn't know what "anupallavi" means. Should not see those words by default.

### 3.1 Wedge persona (v1 launch focus)

For v1 ship, we optimize *first* for the **Indian-language singer-songwriter**
— a subset of the indie-creator persona who:

- already writes lyrics in Hindi or Kannada (or wants to set Tagore/Kabir),
- has been burned by Suno/Lyria mispronunciation,
- doesn't need DAW-grade output; needs a high-quality, listenable demo
  for friends, family, or a YouTube channel,
- is willing to pick from a fixed list of styles and durations.

The "serious composer" and "curious general user" personas are valid but
deferred: the serious composer needs Phase 6 (Indian style modules) and
Phase 10 (Pratyabhijna) to feel finished; the curious user needs Phase 10
prompt UX. The wedge persona is satisfiable end-to-end by Phase 5 with
library lyrics + Western + one Indian style.

## 4. Key user journeys

### 4.1 Lyrics → song (v1 default, pre-Phase-10)

1. User picks language (`hi`, `kn`, `en`) and style family (Western / Carnatic / Hindustani / Kannada-folk).
2. User picks a piece from the public-domain library *(Phase 3)* OR pastes their own lyrics.
3. Frontend posts to `POST /api/songs` with a fully-formed Song Document under `song_document`.
4. Job enqueued; user sees a live status card.
5. Within target latency, user receives a 90 s or 3 min track and an email/push notification.

### 4.2 Prompt → song (Phase 10+, gated by `prompt_enabled`)

1. User picks language and style family.
2. User types a short theme: "monsoon evening in Mysore".
3. Frontend posts to `POST /api/songs` with `{ prompt, language, style_family, target_duration_seconds }`.
4. Pratyabhijna *(Phase 10)* produces a Song Document; the user can preview and edit before generation.
5. Job enqueued; status + delivery as in 4.1. Until Phase 10 ships, this endpoint branch returns `501 prompt_branch_not_yet_enabled`.

### 4.3 Structured song creation (advanced)

1. User manually edits sections (pallavi/charanam, mukhda/antara) and toggles advanced fields (raga, tala, instruments).
2. Co-composer suggests melodic and rhythmic structures *(Phase 2/6)*.
3. User accepts, submits, can later revise just one section and regenerate that audio piece.

### 4.4 Library and reuse

1. User browses past songs, favorites a few.
2. User clones one and changes `style_family` from `kannada-folk` to `hindustani` to compare renditions.

## 5. Functional requirements

| ID  | Requirement                                                                                       | Lands in phase |
| --- | ------------------------------------------------------------------------------------------------- | -------------- |
| F1  | HeartMuLa service generates multi-minute tracks from per-section lyrics + tags.                   | 1, 6           |
| F2  | Worker supports ≥1 concurrent job, max song length 3 min (v1), automatic section combine with fades. | 4              |
| F3  | Cloud API enforces rate limiting and per-tier quotas at `POST /api/songs`.                        | 9              |
| F4  | System supports multi-language Song Documents in `en`, `hi`, `kn` at v1; extensible later.        | 2, 3, 7        |
| F5  | Jobs are idempotent and re-tryable on transient failures.                                         | 4              |
| F6  | Frontend lets users pick from curated Indian styles and Western styles.                           | 5, 6           |
| F7  | Email + push (mobile post-v1) notifications fire on `completed` and `failed`.                     | 9              |
| F8  | Free tier shows remaining-songs indicator.                                                        | 9              |
| F9  | User can view at least a simplified Song Document on the song detail page.                       | 5              |
| F10 | A `prompt` field is accepted on `POST /api/songs` and produces a real Song Document.              | 10             |

## 6. Non-functional requirements

| ID  | Requirement                                                                                 |
| --- | ------------------------------------------------------------------------------------------- |
| N1  | DGX GPU utilisation for music jobs stays below a configured threshold (default 50%).        |
| N2  | P95 latency, 3-minute track, low load: ≤ 5 minutes from submission to playable URL.         |
| N3  | System supports ≥ 100 active users with 5–10 songs/user/day in the prototype phase.         |
| N4  | All external traffic is TLS-encrypted. DGX initiates all production traffic (outbound to Supabase + HF); no public ingress to the DGX in v1. Day-to-day SSH/IDE access is plain LAN (no Tailscale dependency). See [SPEC §2.1](SPEC.md) and [`docs/rejected/tailscale-funnel-pivot.md`](rejected/tailscale-funnel-pivot.md). |
| N5  | All key actions (job creation, completion, failure) are auditable in logs.                  |
| N6  | Creation UI remains responsive regardless of backend load (generation is offline).          |
| N7  | Web app is usable on mid-range phones via mobile web; PWA installable.                      |
| N8  | Initial UI in English; architecture supports later localization into Indian languages.      |
| N9  | Audio URLs are short-lived signed links to protect content.                                 |

## 7. Success metrics (post-launch)

- **Activation**: % of signed-up users who generate ≥ 1 song in the first week.
- **Quality (subjective)**: ≥ 60% "would use again" on internal user testing across Indian language tracks.
- **Pronunciation correctness (objective)**: word-level intelligibility from native-speaker review ≥ 80% on Hindi and Kannada.
- **DGX cohabitation**: zero LLM fine-tune job displacements due to music governor failure.
- **Cost per track**: well under 1 ¢ (just DGX power + Supabase bandwidth).

## 8. v1 scope ladder (locked)

- **Surface**: web only.
- **Styles**: Western, Carnatic, Hindustani, Kannada-folk.
- **Languages**: English, Hindi, Kannada.
- **Durations**: 30 s, 60 s, 90 s, 3 min. 30 s and 3 min are phase-gated; 60 s and 90 s come along for free.
- **Auth**: Supabase Auth (email + OAuth).
- **Storage**: Supabase Storage, signed URLs.
- **Queue**: pgmq inside Supabase Postgres.
- **No**: payments, public API/MCP, mobile apps, stems, MIDI/notation export, in-app cloning of reference audio.

## 9. Cost story (honest)

The "well under 1 ¢ per track" line above is true *only* for variable cost
(DGX power + Supabase bandwidth on the free tier). It excludes:

- **DGX hardware capex**, treated as sunk for this project.
- **Vercel + Supabase** above the free tier (kicks in at modest user counts;
  ADR 0005 caps free-tier storage to keep Supabase free-tier viable for
  the first ~100 users).
- **Bandwidth egress** if Supabase Storage hits its free-tier ceiling —
  signed URLs serve directly from Supabase, so user listens consume their
  egress budget.
- **DLQ inspection and on-call cost** (one engineer-hour/week if v1 attracts
  meaningful usage; ADR 0008 sets up the queue, not the human).

The 1 ¢ figure stands for the marginal per-track cost once a user is already
within free-tier limits. It is not a fully-loaded unit economics number.
Phase 9 (quotas) is the gate that protects the free tier from being abused
into paid territory.

## 10. Abuse mitigations (v1)

The free, public surface invites three classes of abuse the PRD must
acknowledge:

1. **Generation flooding** — bots creating thousands of jobs to drain DGX
   time. Mitigations: per-user quota (3 songs/month free tier), per-IP rate
   limit at the Vercel edge (10 POST /api/songs per hour anonymous, 30 per
   hour authenticated), Supabase Auth required for `POST /api/songs`
   (no anonymous generation).

2. **Lyrics-based prompt injection / disallowed content** — copyrighted
   lyrics, hate speech, sexual content involving minors. Mitigations:
   ADR 0006 enforces PD provenance on the bundled corpus; user-supplied
   lyrics pass through a basic blocklist + length cap (4000 chars) at
   `POST /api/songs`; outputs are tied to `user_id` so abuse is
   attributable; explicit ToS in v1 launch.

3. **Storage as free CDN** — users uploading lyrics, generating tracks, and
   sharing signed URLs as their own hosting. Mitigations: ADR 0005's
   short-lived signed URLs (1 hour free tier) + rolling 30-day retention
   make this impractical compared to actual CDNs.

Out of scope for v1: copyright-similarity detection on generated audio
(deferred; the Apache-2.0 HeartMuLa weights make this an open research
problem). Recorded as a v2 risk.

## 11. Open questions

- Should v1 free tier cap song count per month or compute minutes? Default: count (3 songs/month/user free tier).
- Should we expose raga/tala names to "curious general user" persona by default? Default: no, hide under an "advanced" toggle.
- How do we measure pronunciation quality without a human review every release? Open — track in Phase 7.
