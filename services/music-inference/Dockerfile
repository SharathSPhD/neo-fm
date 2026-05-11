# neo-fm music-inference container
#
# Phase 0: thin FastAPI app, no HeartMuLa, /healthz responds and /v1/generate
#          returns 501 with a contract-correct error shape. CI just verifies it builds.
# Phase 1: switches to nvcr.io/nvidia/pytorch:24.08-py3, installs the heartmula
#          lib, downloads m-a-p/HeartMuLa-oss-3B at build or first boot, and
#          POST /v1/generate returns a real WAV.
#
# Aarch64 (DGX Spark / NVIDIA GB10). Pin tags — never `latest`.

FROM python:3.12-slim AS phase0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /app

RUN pip install --no-cache-dir uv==0.9.28

COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-dev || uv sync --no-dev

COPY app ./app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; \
                 r=urllib.request.urlopen('http://localhost:8000/healthz', timeout=4); \
                 sys.exit(0 if r.status==200 else 1)" || exit 1

CMD ["uv", "run", "uvicorn", "app.serve:app", "--host", "0.0.0.0", "--port", "8000"]
