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

ENV MUSIC_INFERENCE_FAKE_MODEL=1
CMD ["uv", "run", "uvicorn", "app.serve:app", "--host", "0.0.0.0", "--port", "8000"]


# ----- phase1 stage (DGX, real model) ---------------------------------------
# NVIDIA's PyTorch container ships torch+CUDA+cuDNN already tuned for
# Grace-Blackwell and Hopper. We layer heartlib + the app on top.
#
# Tag pin: 24.08-py3 ships torch 2.4.0 + python 3.10. We respect that
# pin rather than fighting it; the music-inference app is python-version
# agnostic and our pyproject.toml `requires-python = ">=3.10"` reflects
# that.
FROM nvcr.io/nvidia/pytorch:24.08-py3 AS phase1

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
ARG HEARTLIB_REF=main
RUN git clone https://github.com/HeartMuLa/heartlib.git /opt/heartlib \
 && cd /opt/heartlib \
 && git checkout "$HEARTLIB_REF" \
 && pip install -e .

# huggingface_hub for `scripts/download-heartmula.py` (operator runs
# this once after first boot), plus soundfile for the
# format-normalisation path in app/model.py.
RUN pip install --no-cache-dir "huggingface_hub>=0.25" "soundfile>=0.12" "numpy>=1.26"

WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
COPY scripts ./scripts
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
