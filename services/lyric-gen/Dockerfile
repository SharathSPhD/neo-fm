# neo-fm lyric-gen container (IndicBART SFT sidecar)
#
# Two stages — same pattern as music-inference:
#   phase0  : python:3.12-slim, no torch, no IndicBART. CI smoke build.
#   dgx     : nvcr.io/nvidia/pytorch:25.11-py3, full ML deps. DGX runtime.
#
# Switch via STAGE build-arg or LYRIC_GEN_STAGE compose variable.

ARG STAGE=phase0

# ----- phase0 (CI smoke) ---------------------------------------------------
FROM python:3.12-slim AS phase0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /app

RUN pip install --no-cache-dir uv==0.9.28

COPY pyproject.toml uv.lock* README.md ./
RUN uv sync --frozen --no-dev || uv sync --no-dev

COPY app/ ./app/

ENV PATH="/opt/venv/bin:$PATH"

EXPOSE 8090

CMD ["uvicorn", "app.serve:app", "--host", "0.0.0.0", "--port", "8090", "--log-level", "info"]

# ----- dgx (DGX Spark runtime) ---------------------------------------------
FROM nvcr.io/nvidia/pytorch:25.11-py3 AS dgx

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /app

RUN pip install --no-cache-dir uv==0.9.28

COPY pyproject.toml uv.lock* README.md ./
# Install base deps + training extras for IndicBART SFT path.
RUN uv sync --frozen --no-dev --extra training || uv sync --no-dev --extra training

COPY app/ ./app/

ENV PATH="/opt/venv/bin:$PATH"

EXPOSE 8090

CMD ["uvicorn", "app.serve:app", "--host", "0.0.0.0", "--port", "8090", "--log-level", "info"]

# ----- final ---------------------------------------------------------------
FROM ${STAGE} AS final
