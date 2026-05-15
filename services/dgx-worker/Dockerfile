# neo-fm dgx-worker container
#
# Live: pgmq poller (psycopg) that CAS-claims jobs, calls music-inference over
#       HMAC-signed HTTP, uploads the WAV via Storage REST (apikey + Bearer for
#       sb_secret_* keys), and updates `public.jobs` + `public.tracks`.
# Coming in Phase 8 (ADR 0011): governor-aware drain via /var/run/neo-fm/governor.state
# + new error class `inference_preempted`.

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /app

RUN pip install --no-cache-dir uv==0.9.28

COPY pyproject.toml uv.lock* README.md ./
RUN uv sync --frozen --no-dev || uv sync --no-dev

COPY app ./app

CMD ["uv", "run", "python", "-m", "app.worker"]
