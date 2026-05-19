# neo-fm vocal-synth container — Phase 5+ real impl.
#
# Indic singing voice synthesis (kenpath/svara-tts-v1 or Indic Parler).
# Boots into a FakeVocalModel fallback when no weights are present so
# docker compose stays usable on machines without GPU.
#
# - `phase0`: python:3.12-slim, no torch+CUDA. CI smoke / RALPH gate.
# - `dgx`   : nvcr.io/nvidia/pytorch ships torch+CUDA matched to the host
#             driver. Used on DGX Spark.

ARG STAGE=phase0

# ----- phase0 stage (CI smoke) -----------------------------------------------
FROM python:3.12-slim AS phase0

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir uv==0.9.28

COPY pyproject.toml uv.lock* README.md ./
RUN uv sync --frozen --no-dev || uv sync --no-dev

COPY app ./app

# ----- dgx stage (GPU prod) --------------------------------------------------
FROM nvcr.io/nvidia/pytorch:25.11-py3 AS dgx

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY pyproject.toml README.md ./
COPY app ./app

RUN pip install --no-cache-dir -e ".[tts]"

# ----- final stage -----------------------------------------------------------
FROM ${STAGE} AS final

EXPOSE 8089
CMD ["uvicorn", "app.serve:app", "--host", "0.0.0.0", "--port", "8089"]
