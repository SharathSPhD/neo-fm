# DGX HuggingFace model cache

This is the inventory of every HuggingFace repo the neo-fm services
pull at runtime, plus the canonical snapshot revision currently
materialised on the DGX. Use it as the source of truth when:

- Bringing up a new DGX host (everything below must be present).
- Diagnosing "model didn't load" errors -- compare service env vars
  against the table, then `ls ~/.cache/huggingface/hub/models--<org>--<name>/snapshots/`.
- Pinning a revision for a reproducible eval run.

> Location on disk: `~/.cache/huggingface/hub/models--<org>--<name>`
> (the standard HF `hub` layout, `HF_HOME` unset). Each repo lives under
> `snapshots/<sha>` with content-addressed blobs in `blobs/`.

## Inventory

| Repo | Used by | Gated? | Revision (truncated) | Notes |
|---|---|---|---|---|
| `ai4bharat/IndicBART` | `services/lyric-gen` (default `--base-model`) | open | `78466a0c` | mBART-style Indic decoder. |
| `ai4bharat/IndicF5` | `services/vocal-synth` indicf5 backend | **gated (auto)** | `ba85abed` | F5-TTS for Indic languages. Required for the `VOCAL_MODEL_ID_INDICF5` route. |
| `ai4bharat/indic-parler-tts` | `services/vocal-synth` parler backend | **gated (auto)** | `7b527af5` | Parler-TTS Indic variant. PEFT-compatible. |
| `facebook/musicgen-medium` | `services/music-inference` MusicGen | open | `d3bd7b00` | Default `MUSICGEN_REPO`. ~3 GB but cache balloons to ~11 GB with mirrored encodec/t5 sub-folders. |
| `HeartMuLa/HeartCodec-oss-20260123` | `services/music-inference` HeartMuLa stack | open | `f889dab0` | Codec checkpoint. Bundled into `$HEARTMULA_CKPT_DIR/ckpt/HeartCodec-oss/` by `scripts/download-heartmula.py`. |
| `HeartMuLa/HeartMuLaGen` | `services/music-inference` HeartMuLa stack | open | `9906b2bc` | **Config-only repo** (`gen_config.json` + `tokenizer.json`). No weight file -- expected. |
| `HeartMuLa/HeartMuLa-oss-3B-happy-new-year` | `services/music-inference` HeartMuLa stack | open | `41f6fc68` | 3B autoregressive music decoder. Pulled by `download-heartmula.py`. The legacy ID `HeartMuLa/HeartMuLa-OSS-3B` in `_lora_trainer.py` 307-redirects to `HeartMuLa/HeartMuLa-oss-3B` (note: different repo from this one); both upstream paths resolve, but this "happy-new-year" repo is the canonical big weights bundle. |
| `kenpath/svara-tts-v1` | `services/vocal-synth` svara default | open | `db8a02fc` | Mainline `VOCAL_MODEL_ID_SVARA` default. ~12 GB unpacked (multiple-precision shards). |
| `m-a-p/MERT-v1-95M` | `services/reranker/neofm_reranker/train_apply.py` | open | `12af15fe` | Music-audio embedding model used by the reranker trainer. |
| `Qwen/Qwen2.5-7B-Instruct` | `services/lyric-gen/scripts/eval.py` (`--judge-model` default) | open | `a09a3545` | LLM-as-judge eval-only. The fatter `Qwen/Qwen2.5-14B-Instruct` is also cached for callers that pass `--judge-model` explicitly. |
| `stabilityai/sdxl-turbo` | `services/cover-art-synth` sdxl-turbo backend | open | `71153311` | Fallback cover-art backend. ~53 GB on disk because the repo carries fp16 + fp32 + standalone ckpt + diffusers split. |
| `stabilityai/stable-audio-open-1.0` | `services/stems-synth` (`STEMS_SYNTH_WEIGHTS`) | **gated (auto)** | `f21265c1` | Stable Audio Open. Distilled music gen used for stems. |
| `Tongyi-MAI/Z-Image-Turbo` | `services/cover-art-synth` z-image backend (default) | open | `f332072a` | Canonical Z-Image-Turbo (Alibaba Tongyi-MAI). Replaced the dead `tonyassi/z-image-turbo` reference. Requires `diffusers>=0.36`. |

Disk footprint as of the last full sync: ~155 GB across all repos.

## Authentication

The HF CLI on the DGX is logged in as `qbz506` (see
`hf auth whoami`). The token lives at `~/.cache/huggingface/token`
and is the one all services read implicitly via `huggingface_hub`.

All three gated repos in the table above (`ai4bharat/IndicF5`,
`ai4bharat/indic-parler-tts`, `stabilityai/stable-audio-open-1.0`)
use HuggingFace's `gated=auto` policy -- a one-click "accept terms"
form per repo grants instant access. The token already has all
three accepted. If you rotate the token, click-accept on the same
account before refreshing the cache, otherwise downloads return
HTTP 403 (which `hf download` reports as the misleading
"Repository not found" message).

## Refreshing or bringing up a new DGX

```bash
# 1. log in / accept gates on the qbz506 (or whichever) HF account
hf auth login   # paste token; needs read access to the gated repos

# 2. pull every repo in one shot (idempotent; existing snapshots are skipped)
TOKEN=$(cat ~/.cache/huggingface/token)
REPOS=(
  "ai4bharat/IndicBART"
  "ai4bharat/IndicF5"
  "ai4bharat/indic-parler-tts"
  "facebook/musicgen-medium"
  "HeartMuLa/HeartCodec-oss-20260123"
  "HeartMuLa/HeartMuLaGen"
  "HeartMuLa/HeartMuLa-oss-3B-happy-new-year"
  "kenpath/svara-tts-v1"
  "m-a-p/MERT-v1-95M"
  "Qwen/Qwen2.5-7B-Instruct"
  "stabilityai/sdxl-turbo"
  "stabilityai/stable-audio-open-1.0"
  "Tongyi-MAI/Z-Image-Turbo"
)
for r in "${REPOS[@]}"; do
  hf download "$r" --token "$TOKEN" --max-workers 6 --quiet &
done
wait
```

## Verifying integrity

After a fresh sync, run this to confirm every repo is at its
upstream `main` and has no half-downloaded shards:

```bash
TOKEN=$(cat ~/.cache/huggingface/token)
for r in ai4bharat/IndicBART ai4bharat/IndicF5 ai4bharat/indic-parler-tts \
         facebook/musicgen-medium HeartMuLa/HeartCodec-oss-20260123 \
         HeartMuLa/HeartMuLaGen HeartMuLa/HeartMuLa-oss-3B-happy-new-year \
         kenpath/svara-tts-v1 m-a-p/MERT-v1-95M Qwen/Qwen2.5-7B-Instruct \
         stabilityai/sdxl-turbo stabilityai/stable-audio-open-1.0 \
         Tongyi-MAI/Z-Image-Turbo; do
  org=${r%%/*}; name=${r##*/}
  cached=$(ls -t ~/.cache/huggingface/hub/models--${org}--${name}/snapshots/ 2>/dev/null | head -1)
  upstream=$(curl -s -H "Authorization: Bearer $TOKEN" \
             "https://huggingface.co/api/models/$r" \
             | python3 -c "import sys,json; print(json.load(sys.stdin).get('sha',''))")
  if [ "$cached" = "$upstream" ]; then
    printf "  %-50s match\n" "$r"
  else
    printf "  %-50s DRIFT cached=%s upstream=%s\n" "$r" "${cached:0:12}" "${upstream:0:12}"
  fi
done
find ~/.cache/huggingface/hub -name '*.incomplete'   # must print nothing
```

## Known gotchas

- **`hf download` reports gated 403s as "Repository not found".**
  Set `HF_DEBUG=1` to see the real `GatedRepoError` with the access
  URL. The fix is always: open the model page on huggingface.co, scroll
  to the access form, accept terms with the same account whose token
  is on disk.

- **`stabilityai/sdxl-turbo` is ~53 GB on disk** even though the model
  itself is ~6 GB. The repo carries fp16 + fp32 + standalone ckpt
  + diffusers split as separate sibling files. This is expected.

- **`HeartMuLa/HeartMuLaGen` is config-only.** It contains
  `gen_config.json` and `tokenizer.json` only. The actual weights
  live in the sibling `HeartMuLa/HeartMuLa-oss-3B-happy-new-year` and
  `HeartMuLa/HeartCodec-oss-20260123` repos. The
  `scripts/download-heartmula.py` orchestrator stitches all three
  into `$HEARTMULA_CKPT_DIR/ckpt/` as the heartlib quickstart README
  expects.

- **`HeartMuLa/HeartMuLa-OSS-3B` redirects to `HeartMuLa/HeartMuLa-oss-3B`**
  (note the lowercase `oss`). Both are different from the
  `HeartMuLa/HeartMuLa-oss-3B-happy-new-year` repo that the dedicated
  download script targets. The `_lora_trainer.py` default
  (`HeartMuLa/HeartMuLa-OSS-3B`) currently relies on the upstream
  redirect; consider canonicalising the string in code to avoid one
  extra 307 round-trip per cold start.

- **`tonyassi/z-image-turbo` 404s upstream.** The cover-art z-image
  default was migrated to `Tongyi-MAI/Z-Image-Turbo` (the canonical
  Alibaba release). Anything in CI that hard-codes the old ID should
  be updated.
