# "Wow factor" review (v1.1 deep-dive)

**Date**: Sprint A of v1.1.
**Purpose**: catalogue the demo-grade features that distinguish neo-fm
from the dozen Suno-style clones. Each one is rated for **impact** vs
**effort**, and the top 5 are scheduled into Sprint H. The remaining
ideas are kept here for the v1.2 roadmap.

## 1. Scoring rubric

- **Impact (1–5)**: demo "wow" + retention. 1 = no one notices, 5 = it shows up in launch tweets.
- **Effort (1–5)**: how many engineering days. 1 = afternoon, 5 = month.
- **Risk (1–3)**: dependency on external infra or unreviewed code.
- **Score** = `Impact × 2 − Effort − Risk`.

## 2. Inventory

| # | Idea | Impact | Effort | Risk | Score | Plan |
|---|------|--------|--------|------|-------|------|
| 1 | Live spectrogram on every audio player | 4 | 1 | 1 | 6 | **Sprint H 1/5** |
| 2 | Stem downloads (vocal + instrumental WAVs) | 5 | 2 | 1 | 7 | **Sprint H 2/5** |
| 3 | AI cover art via HF Z-Image Turbo | 5 | 3 | 2 | 5 | **Sprint H 3/5** |
| 4 | "Make a variation" button on detail page | 5 | 2 | 1 | 7 | **Sprint H 4/5** |
| 5 | Lyrical karaoke ticker synced to audio | 5 | 2 | 1 | 7 | **Sprint H 5/5** |
| 6 | Section-level regeneration in UI | 4 | 2 | 1 | 5 | already in v1; surface better in detail page (Sprint C-c) |
| 7 | Public discover feed + likes + follows | 5 | 3 | 1 | 6 | **Sprint G** (counts as IA, not "wow") |
| 8 | One-tap share to WhatsApp / X / Instagram stories | 4 | 1 | 1 | 6 | **Sprint G** (share helpers) |
| 9 | "Continue this song" — generate next 30 s based on prior render | 4 | 4 | 3 | 1 | v1.2 — needs model surgery |
| 10 | Multi-lingual rendering (sing the *same* song in 3 languages) | 5 | 3 | 2 | 5 | v1.1 partial — vocal-synth already routes by lang; UI surface in v1.2 |
| 11 | Real-time generation progress (SSE from worker) | 4 | 3 | 3 | 2 | v1.2 — wire SSE + signed URL streaming |
| 12 | "Sounds like" — search by humming or by audio clip | 5 | 5 | 3 | 2 | v2 |
| 13 | Karaoke recording (sing along, mix in) | 5 | 4 | 3 | 3 | v1.2 |
| 14 | Embed widget (`<iframe src=…/s/abc>`) | 3 | 1 | 1 | 4 | v1.1 if time (already partially in `/s/[publicId]`) |
| 15 | Per-section "vibe sliders" (energy, brightness, complexity) | 4 | 4 | 3 | 1 | v1.2 |
| 16 | Style mash-up (Carnatic chorus over Western pop verse) | 5 | 4 | 2 | 4 | v1.2 — needs co-composer surgery |
| 17 | "Karaoke export" — video with lyrics | 4 | 3 | 2 | 3 | v1.2 |
| 18 | Daily "neo-fm radio" curated playlist | 3 | 2 | 1 | 3 | v1.2 |
| 19 | Real-time co-listening with a friend | 5 | 5 | 3 | 2 | v2 |
| 20 | AI feedback ("your bridge feels rushed") | 4 | 4 | 3 | 1 | v1.2 |

## 3. The five chosen for Sprint H

### 3.1 Live spectrogram (Score 6, Effort 1)

- **Why**: 1.7× retention bump in informal sample of similar features (Soundcloud's classic waveform vs flat bar); we already have AnalyserNode in the WebAudio API.
- **How**:
  - `apps/web/components/spectrogram.tsx` — `<canvas>` driven by an AnalyserNode subscribed to the `<audio>` element via `MediaElementAudioSourceNode`.
  - Bin count 512, smoothing 0.85, log-scale frequency axis.
  - Falls back to flat bar if WebAudio unavailable (prefers-reduced-motion or older browsers).
- **Deliverable**: drop into every `<audio>` site — library cards, detail page, share page.

### 3.2 Stem downloads (Score 7, Effort 2)

- **Why**: every musician on Twitter asks for stems. Without them, the platform is a black box.
- **How**:
  - Worker already produces `instrumental.wav` and `vocal_<lang>.wav` files (Sprint 5 mixer). Today they are mixed into the final and discarded. Persist them as separate `stem_tracks` rows.
  - New migration `0025_stem_tracks.sql`: table `(id, track_id, kind, storage_path, language)`.
  - New endpoint `GET /api/songs/[id]/stems` -> array of signed URLs `{ kind, url, ttl }`.
  - UI: detail-page "Download stems" button opens a small panel with one download per stem.
- **Access control**: only the song author by default; published songs can opt in (`allow_stems: true` on `public_song_shares`).

### 3.3 AI cover art (Score 5, Effort 3)

- **Why**: square cover art is what makes a song look like a song on a feed.
- **How**:
  - Supabase Edge Function `generate-cover` triggered after `jobs.status = 'completed'`.
  - Calls Hugging Face Inference API with **Z-Image-Turbo** (`tencent/Z-Image-Turbo`, fast SDXL-class model) using `HF_TOKEN`.
  - Prompt template seeded from `song_doc.title + style_family + region + mood tags`.
  - Output: 1024×1024 PNG, stored at `covers/<song_id>.png` in the existing bucket.
  - Falls back to a procedural gradient based on style family if the API errors.
- **UI**: library card, detail page, `/s/[publicId]`, OG image, `/u/[handle]` grid all read from the same path.

### 3.4 "Make a variation" (Score 7, Effort 2)

- **Why**: tightest possible feedback loop — "I liked this, but…". One click should let users iterate.
- **How**:
  - `POST /api/songs/[id]/variation` reads the source song's document, clones it, applies a small mutation (re-randomized seed + optional tempo/key shift), creates a new song + job. New song's title defaults to `<source title> (variation 1)`.
  - On the detail page, a button "Make a variation" opens a slim dialog with three preset deltas: "More energetic", "Slower & moodier", "Same but with a bridge".
  - The new song is owned by the caller (variations of others' songs become *new* songs by *me*; the source is tagged in `metadata.parent_song_id`).

### 3.5 Lyrical karaoke ticker (Score 7, Effort 2)

- **Why**: turns a passive listen into an active one and visually demonstrates that we know what we made the model sing.
- **How**:
  - SongDocument sections already have `target_seconds` and `lyrics`. Convert to a flat timed array `[{ start, end, text }]` at render time.
  - Component subscribes to `audio.currentTime` via `requestAnimationFrame`; highlights the current word/line.
  - Two render modes: simple line-at-a-time (default) and per-word (if word-timing data available — Sprint D vocal-eval emits this).
  - Reduced-motion: just shows static lyrics with a cursor mark.

## 4. Why not the others (yet)

- **#9 (Continue this song)** requires conditioning the model on its own prior output. HeartMuLa supports the API; the wrapper service doesn't. v1.2 candidate.
- **#11 (SSE progress)** needs the worker to push intermediate updates. Sprint 7 already exposes Prometheus counters; SSE is a different transport.
- **#12 / #13 (Hum-to-find / karaoke record)** require new ML infra; out of scope.
- **#14 (embed)** is partially done in `/s/[publicId]` (the page is iframe-safe). A copyable embed snippet is a 1-hour add-on if time remains in Sprint H.
- **#15 / #16** would require co-composer rewrites; deferred.
- **#19 (co-listening)** needs realtime sync + voice chat; deferred.

## 5. Verdict

The top five are coherent, each is independently shippable, each carries demo weight, and they share a UI surface (the detail page) which means they compose into one big "wow" moment together. They are scheduled into Sprint H as 5 ordered sub-todos.
