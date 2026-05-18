# neo-fm pwm-api container.
#
# The Pratyabhijñā World Model (PWM) project carries a large ML stack
# (torch, transformers, a trained checkpoint, Ollama sidecar). Rather
# than duplicating those deps into a neo-fm image, this container:
#
#   - Mounts the PWM project, the pwm-phase2 source, and the operator's
#     pre-built `vllm-env` python environment from the DGX host
#     (see infra/docker-compose.dgx.yml volumes).
#   - Provides only the thin FastAPI wrapper (serve.py) and a CUDA-capable
#     base image so torch can find its libraries.
#
# The wrapper is engineered to degrade gracefully when the host mounts
# are missing (e.g. CI smoke on a workstation): /healthz reports 503
# `pwm_ready: false` instead of crashing the process.

ARG STAGE=phase1

# ----- phase0 stage (CI smoke, no GPU, no PWM checkout) ---------------------
# Built by the CI workflow as a sanity check that the FastAPI surface
# imports without the real backend. `PWM_SKIP_BACKEND_IMPORT=1` keeps
# the wrapper from ever trying to load `api.main`.
FROM python:3.12-slim AS phase0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PWM_SKIP_BACKEND_IMPORT=1

WORKDIR /app

RUN pip install --no-cache-dir \
      "fastapi>=0.115" \
      "uvicorn[standard]>=0.32" \
      "pydantic>=2.9.0" \
      "httpx>=0.27" \
 && rm -rf /root/.cache/pip

COPY serve.py ./
COPY __init__.py ./
COPY pyproject.toml ./

EXPOSE 9000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; \
                 r=urllib.request.urlopen('http://localhost:9000/healthz', timeout=4); \
                 sys.exit(0 if r.status==200 else 1)" || exit 1

CMD ["uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "9000"]


# ----- phase1 stage (DGX, GPU, real PWM backend) ----------------------------
# NVIDIA's PyTorch container ships torch + CUDA + cuDNN compatible with the
# GB10 (DGX Spark). We layer fastapi/uvicorn on top and rely on volume mounts
# for the PWM project, pwm-phase2 source, and the operator's vllm-env (which
# carries the LLM + huggingface deps the PWM backend imports lazily).
#
# Tag pin: matches music-inference 25.11-py3 — the first NGC release with
# DGX Spark support. Keep both services on the same tag so torchaudio /
# numpy / torch are pinned identically across the stack.
FROM nvcr.io/nvidia/pytorch:25.11-py3 AS phase1

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# curl for the docker healthcheck (CMD form used in compose).
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# The wrapper only needs FastAPI/uvicorn/pydantic + httpx + requests.
# Heavier PWM deps come from the mounted vllm-env at /opt/vllm-env.
RUN pip install --no-cache-dir \
      "fastapi>=0.115" \
      "uvicorn[standard]>=0.32" \
      "pydantic>=2.9.0" \
      "httpx>=0.27" \
      "requests>=2.32"

# PWM's `api/main.py` does `sys.path.insert(0, str(Path(__file__).parents[1]))`
# so we need the `api` package importable as `api`. The wrapper adds
# /opt/pwm and /opt/pwm-phase2 to sys.path at startup, so `from api import
# main` resolves to /opt/pwm/api/main.py.
ENV PWM_PROJECT_PATH=/opt/pwm \
    PWM_PHASE2_PATH=/opt/pwm-phase2 \
    PYTHONPATH=/opt/pwm:/opt/pwm-phase2:/opt/vllm-env/lib/python3.12/site-packages

COPY serve.py ./
COPY __init__.py ./
COPY pyproject.toml ./

EXPOSE 9000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -fsS http://localhost:9000/healthz || exit 1

CMD ["uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "9000"]


# ----- final ----------------------------------------------------------------
FROM ${STAGE} AS final
