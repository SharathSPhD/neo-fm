# neo-fm music-inference container
#
# Two stages so we keep CI fast while real GPU bring-up uses the heavy base.
#
# - `phase0`  : python:3.12-slim, no heartlib, no torch. Build is ~30s.
#               Used by .github/workflows/docker-build.yml as a smoke check.
# - `phase1`  : nvcr.io/nvidia/pytorch:24.08-py3, clones heartlib, installs
#               app deps. Used on the DGX. Build is ~10 minutes the first
#               time; layer cache makes subsequent builds fast.
#
# Switch the runtime target via `docker compose --build-arg STAGE=phase1`
# or `docker build --target phase1`.

ARG STAGE=phase0

# ----- phase0 stage (CI smoke) ----------------------------------------------
FROM python:3.12-slim AS phase0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /app

RUN pip install --no-cache-dir uv==0.9.28

COPY pyproject.toml uv.lock* README.md ./
RUN uv sync --frozen --no-dev || uv sync --no-dev

COPY app ./app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; \
                 r=urllib.request.urlopen('http://localhost:8000/healthz', timeout=4); \
                 sys.exit(0 if r.status==200 else 1)" || exit 1

# The `phase0` stage exists to validate the FastAPI surface without weights
# or GPU. The fake-model path is opt-in via two env vars (see
# `app/model.py::initialise_from_env`) so an accidental env-var inheritance
# in the `phase1` GPU image cannot silently degrade to silence.
ENV MUSIC_INFERENCE_FAKE_MODEL=1 \
    MUSIC_INFERENCE_ALLOW_FAKE=1
CMD ["uv", "run", "uvicorn", "app.serve:app", "--host", "0.0.0.0", "--port", "8000"]


# ----- phase1 stage (DGX, real model) ---------------------------------------
# NVIDIA's PyTorch container ships torch+CUDA+cuDNN already tuned for
# Grace-Blackwell and Hopper. We layer heartlib + the app on top.
#
# Tag pin: 25.11-py3 — ships PyTorch 2.10.0a0 + CUDA 13.0.2 and is the
# first release with GB10 (DGX Spark) support. 24.08 fails to start
# with "Detected NVIDIA GB10 GPU, which is not yet supported in this
# version of the container". 25.12 has a torchaudio incompatibility
# on GB10; 25.11 is the safe pick. pyproject `requires-python = ">=3.10"`
# remains compatible.
FROM nvcr.io/nvidia/pytorch:25.11-py3 AS phase1

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /opt

# git + ffmpeg (mp3 -> wav transcode fallback). Everything else is in
# the NVIDIA base image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# Clone heartlib at a pinned commit. The upstream README pins to main;
# we pin to a SHA the operator can update via the bring-up script.
#
# CRITICAL: install with --no-deps. heartlib pins `torch>=2.4,<2.11`
# which matches the NGC-shipped torch (2.10.0a0+b558c98) on paper but
# pip resolves the `a0` pre-release as "less than 2.10" and pulls the
# CPU-only PyPI wheel on aarch64, replacing the GPU-enabled NGC build
# and yielding `Torch not compiled with CUDA enabled` at runtime.
# We install heartlib's own python deps explicitly *minus* the torch
# stack so the NGC GPU torch stays intact.
# Strip torchaudio out of heartlib at install time. NGC PyTorch 25.11 on
# aarch64 / GB10 (DGX Spark) does not ship torchaudio, and PyPI's
# torchaudio wheels are ABI-incompatible with the NGC-built torch
# (`undefined symbol` on libtorchaudio.so). heartlib's only torchaudio
# call is `torchaudio.save(...)` for writing the final WAV, which is
# pure CPU I/O -- soundfile is a drop-in.
# Upstream issue: https://github.com/pytorch/audio/issues/4169
ARG HEARTLIB_REF=main
RUN git clone https://github.com/HeartMuLa/heartlib.git /opt/heartlib \
 && cd /opt/heartlib \
 && git checkout "$HEARTLIB_REF" \
 && sed -i \
      -e 's|^import torchaudio$|import soundfile as _sf  # patched: torchaudio unavailable on GB10|' \
      -e 's|torchaudio.save(save_path, wav.to(torch.float32).cpu(), 48000)|_sf.write(save_path, wav.to(torch.float32).cpu().numpy().T, 48000)|' \
      src/heartlib/pipelines/music_generation.py \
 && pip install --no-cache-dir --no-deps -e . \
 && pip install --no-cache-dir --no-deps \
      "torchtune==0.4.0" \
      "torchao==0.9.0" \
 && pip install --no-cache-dir \
      "transformers==4.57.0" \
      "tokenizers==0.22.1" \
      "accelerate==1.12.0" \
      "bitsandbytes==0.49.0" \
      "vector-quantize-pytorch==1.27.15" \
      "modelscope==1.33.0" \
      "einops==0.8.1" \
      "tqdm==4.67.1" \
      "traitlets==5.7.1" \
      "traittypes==0.2.3" \
      "ipykernel==6.17.1" \
      "soundfile" \
      "omegaconf" \
      "datasets" \
      "safetensors" \
      "sentencepiece" \
      "tiktoken" \
      "blobfile" \
      "pyyaml"

# huggingface_hub for `scripts/download-heartmula.py` (operator runs
# this once after first boot). numpy is supplied by NGC; we explicitly
# DO NOT upgrade it here because heartlib pins numpy==2.0.2 but NGC
# ships 2.0.2 on 25.11 already.
RUN pip install --no-cache-dir "huggingface_hub>=0.25"

WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir "fastapi>=0.115" "uvicorn[standard]>=0.32" "pydantic>=2.9.0"

ENV HEARTMULA_CKPT_DIR=/mnt/models/heartmula

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD python -c "import urllib.request,sys; \
                 r=urllib.request.urlopen('http://localhost:8000/healthz', timeout=4); \
                 sys.exit(0 if r.status==200 else 1)" || exit 1

CMD ["uvicorn", "app.serve:app", "--host", "0.0.0.0", "--port", "8000"]


# ----- final ----------------------------------------------------------------
FROM ${STAGE} AS final
