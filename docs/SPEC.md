# neo-fm — Technical Specification

Status: living document. Owners: SharathSPhD.

## 1. System overview

neo-fm is an India-first, composition-aware AI music platform. It takes a user theme or lyrics, produces a structured **Song Document**, expands it through style-aware **co-composition** rules, and renders a multi-minute audio track via **HeartMuLa** (instrumental + non-Indic vocals) with optional **svara-TTS** layered Indic vocals.

The system is split across three runtime tiers:

- **Cloud** (Vercel + Supabase): web UI, REST API, auth, persistence, queue.
- **DGX Spark** (Docker over Tailscale, outbound only): music-inference, dgx-worker, vocal-synth.
- **External**: Pratyabhijna creative engine (Phase 10).

## 2. Architecture

```mermaid
flowchart LR
    User[Browser PWA] -->|REST| WebAPI[Next.js on Vercel]
    WebAPI <-->|RLS rows| SupaDB[("Supabase Postgres")]
    WebAPI -->|enqueue| Queue[("pgmq queue")]
    SupaAuth[Supabase Auth] --> WebAPI
    Queue <-->|poll| DGXWorker
    DGXWorker -->|HTTP| MusicInf["music-inference (HeartMuLa)"]
    DGXWorker -->|HTTP| VocalSynth["vocal-synth (svara-TTS)"]
    DGXWorker -->|signed PUT| SupaStore[("Supabase Storage")]
    DGXWorker -->|update job row| SupaDB
    User -->|signed GET| SupaStore
    subgraph DGX["DGX Spark over Tailscale (outbound)"]
        DGXWorker
        MusicInf
        VocalSynth
    end
```

### 2.1 Trust boundary

Cloud → DGX traffic is impossible by design. The DGX initiates all connections: it polls Supabase Postgres (`pgmq`), reads Song Documents, writes job status, and uploads audio via signed PUT URLs. The cloud never holds DGX credentials beyond what Tailscale exposes to the DGX itself.

## 3. Component contracts

Authoritative API definitions live next to this spec:

- Cloud API: [contracts/openapi-cloud.yaml](contracts/openapi-cloud.yaml).
- DGX music-inference: [contracts/openapi-dgx.yaml](contracts/openapi-dgx.yaml).
- Queue message: [contracts/queue-message.schema.json](contracts/queue-message.schema.json).

The Cloud API is the **only** public surface. The DGX API is internal — only `dgx-worker` calls it, over the loopback or the docker-compose network.

### 3.1 Cloud API summary

| Method | Path                    | Purpose                                              |
| ------ | ----------------------- | ---------------------------------------------------- |
| `POST` | `/api/auth/signup`      | Supabase Auth passthrough.                           |
| `POST` | `/api/auth/login`       | Supabase Auth passthrough.                           |
| `GET`  | `/api/me`               | Current user profile + tier.                         |
| `POST` | `/api/songs`            | Submit Song Document or prompt → enqueue job.        |
| `GET`  | `/api/songs`            | List user songs.                                     |
| `GET`  | `/api/songs/{id}`       | One song with job status and signed audio URL.       |
| `GET`  | `/api/healthz`          | Liveness.                                            |

### 3.2 DGX music-inference summary

| Method | Path             | Purpose                                                                   |
| ------ | ---------------- | ------------------------------------------------------------------------- |
| `POST` | `/v1/generate`   | Generate audio for one Song Document (one or more sections).              |
| `GET`  | `/healthz`       | Liveness + readiness; reports model version, GPU memory, model_loaded.    |

### 3.3 Queue message — `SongGenerationJob`

See [contracts/queue-message.schema.json](contracts/queue-message.schema.json). Fields: `job_id`, `user_id`, `song_document_id`, `priority`, `created_at`, `style_family`, `target_duration_seconds`.

## 4. Song Document DSL

The Song Document is the canonical structured representation across all layers (Pratyabhijna → co-composer → HeartMuLa). Source of truth: [packages/song-doc/src/index.ts](../packages/song-doc/src/index.ts) (Zod). Python mirror: [packages/song-doc/python/neo_fm_song_doc/models.py](../packages/song-doc/python/neo_fm_song_doc/models.py).

### 4.1 Top-level shape

```ts
SongDocument {
  id: UUID
  user_id: UUID
  language: "en" | "hi" | "kn" | string  // ISO 639-1
  style_family: "western" | "carnatic" | "hindustani" | "kannada-folk"
  tempo_bpm?: number
  time_signature?: string       // e.g. "4/4"
  tala?: string                 // e.g. "teentaal", "adi"
  target_duration_seconds: number
  sections: Section[]
  orchestration?: Orchestration
  raga?: RagaSpec
  metadata?: Record<string, unknown>
}
```

### 4.2 Section enum (v1)

Style-agnostic union covering Western, Carnatic, Hindustani, and folk forms:

```
intro | verse | chorus | bridge | outro |
pallavi | anupallavi | charanam |
mukhda | antara |
saranam |
alaap | sargam |
folk_refrain | folk_stanza
```

Each section carries: `id`, `type`, optional `lyrics`, optional `script` (Devanagari/Tamil/Kannada/Latin), optional `transliteration`, optional `swara_sequence` (sargam), optional `phonemes` (Phase 7), `target_seconds`.

### 4.3 RagaSpec

```ts
RagaSpec {
  name: string            // "kalyani", "yaman", "bhairavi"
  system: "carnatic" | "hindustani"
  arohana?: string[]      // ["S", "R2", "G3", "M2", "P", "D2", "N3", "S'"]
  avarohana?: string[]
  nyas?: string[]
  pakad?: string
}
```

### 4.4 Orchestration

```ts
Orchestration {
  lead_vocal?: "male" | "female" | "instrumental"
  instruments?: string[]   // ["mridangam", "tanpura", "violin"]
  texture?: string         // "sparse", "full-band", "drone+lead"
}
```

## 5. Data model (Supabase, Phase 4)

```sql
users           (id PK, email, name, locale, tier, created_at)
song_documents  (id PK, user_id FK, language, style_family, document_json JSONB, created_at)
jobs            (id PK, user_id FK, song_document_id FK, status, priority,
                 error, created_at, started_at, finished_at)
tracks          (id PK, job_id FK, url, duration_seconds, format, created_at)
subscriptions   (id PK, user_id FK, plan, status, renew_at)
```

Row-level security:

- `users` — self read; admin write.
- `song_documents` / `jobs` / `tracks` — `user_id = auth.uid()` for SELECT/INSERT; UPDATE limited to service role for status fields.

Queue: pgmq `song_generation_jobs` queue, polled by `dgx-worker`. Decision: [DECISIONS/0001-queue.md](DECISIONS/0001-queue.md).

## 6. Models and licenses

| Model                       | License                            | Role                                |
| --------------------------- | ---------------------------------- | ----------------------------------- |
| `m-a-p/HeartMuLa-oss-3B`    | Apache 2.0                         | Instrumental + non-Indic vocals     |
| `kenpath/svara-tts`         | (verify at integration, Phase 7)   | Indic singing voice                 |
| AI4Bharat Indic-TTS         | MIT-style / open                   | G2P for 13 Indian languages         |
| IITM Indic-TTS CLS          | Research-use                       | Common Label Set phoneme inventory  |

Weight downloads are gitignored. Phase 1 commits the download script and a model-card snapshot, not the weights themselves.

## 7. TRIZ contradictions and resolutions

These are also tracked as ADRs under [DECISIONS/](DECISIONS/) and resolved through `contradiction-agent → solution-agent → evaluator-agent`.

- **C1: DGX runs music AND must stay free for LLM fine-tuning** → #15 Dynamism + #25 Self-service. Utilization-aware governor in `dgx-worker` reading `nvidia-smi`; music capped at ≤50% GPU; priority queue lets fine-tuning preempt.
- **C2: Low UX latency AND batch offline** → #1 Segmentation + #10 Preliminary action. Per-section generation streamed via Supabase Realtime; **eager model load at container boot** so the first request hits a hot model.
- **C3: Authentic Indian vocals AND HeartMuLa weak on Indic phonetics** → #5 Merging + #28 Mechanics substitution. HeartMuLa renders instrumental; svara-TTS renders vocals from melody + Indic G2P phonemes; mixer stitches stems.
- **C4: Free service AND zero infra cost AND high quality** → #2 Taking out. No paid third-party APIs; on-prem DGX + Supabase/Vercel free tiers. Optional `LyriaProEngine` adapter ships in Phase 12 for paying users only.
- **C5: Real impl (no mocks) AND fast iteration** → #1 Segmentation + #10 Preliminary action. Smallest real artifact first (FP16 3B, 30s clip), expand outward.

## 8. Observability (Phase 11)

- Prometheus exporters in `music-inference`, `dgx-worker`, `vocal-synth`. Endpoint `GET /metrics`.
- Grafana dashboard JSON committed under [infra/grafana/](../infra/grafana/).
- Health endpoints upgraded to expose: model version, GPU memory used, queue lag, jobs/min, error rate.
- Alert rules: GPU util > threshold (default 50% for music), job-lag > 60s, HeartMuLa error rate > 1% over 5 min.

## 9. Phase deliverables matrix

| Phase | Demo artifact                                                | Container builds | Endpoint output                 |
| ----- | ------------------------------------------------------------ | ---------------- | ------------------------------- |
| 0     | `demos/phase-0-dgx.txt`, `demos/phase-0.png`                 | (skeleton)       | n/a                             |
| 1     | `demos/phase-1.wav` + `nvidia-smi` screenshot                | music-inference  | real 30s WAV                    |
| 2     | `demos/phase-2.wav` + golden snapshot test                   | music-inference  | Western SongDoc → WAV           |
| 3     | `demos/phase-3.wav` + lyrics-from-library                    | music-inference  | real lyrics + 30s WAV           |
| 4     | end-to-end signed URL                                        | + dgx-worker     | `POST /songs` → ready track     |
| 5     | `demos/phase-5.gif` of full UX flow                          | + apps/web       | UI submits and plays            |
| 6     | one 90s WAV per Indian style                                 | (no new image)   | style-correct outputs           |
| 7     | A/B WAVs HeartMuLa-only vs HeartMuLa+svara-TTS               | + vocal-synth    | Indic vocal layered             |
| 8     | governor load-test transcript                                | (no new image)   | worker yields to fine-tune      |
| 9     | PWA install screenshot + quota enforcement test              | (no new image)   | quota 429 on N+1                |
| 10    | `POST /songs` with `prompt` → Kannada SongDoc + 90s WAV      | (no new image)   | real Pratyabhijna output        |
| 11    | `demos/phase-11-grafana.png` + alert-fired screenshot        | exporters in all | metrics visible                 |
| 12    | A/B WAV `HeartMuLa` vs `Lyria 3 Pro`                         | (no new image)   | pro-tier routing                |

## 10. v1 scope (locked)

- **Surface**: web only. Mobile (React Native/Expo) is post-v1.
- **Styles**: Western, Carnatic, Hindustani, Kannada-folk.
- **Languages**: English, Hindi, Kannada.
- **Durations**: 30 s, 60 s, 90 s, 3 min (30 s and 3 min are the phase-gated targets).
- **Out of scope**: payments, public MCP exposure, managed-API pro tier (Phase 12 deferred).
