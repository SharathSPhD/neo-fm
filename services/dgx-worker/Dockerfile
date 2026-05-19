# neo-fm dgx-worker container
#
# Two stages so CI smoke builds stay fast.
#
# - `phase0`: python:3.12-slim, no GPU deps. Used by RALPH gate + CI.
# - `dgx`   : same slim base (dgx-worker has no torch dep), but production
#              may layer in NVIDIA runtime at deploy time via compose.
#
# Live: pgmq poller (psycopg) that CAS-claims jobs, calls music-inference over
#       HMAC-signed HTTP, uploads the WAV via Storage REST, and updates
#       `public.jobs` + `public.tracks`.

ARG STAGE=phase0

# ----- phase0 stage (CI smoke) -----------------------------------------------
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

# ----- final stage -----------------------------------------------------------
FROM ${STAGE} AS final

CMD ["uv", "run", "python", "-m", "app.worker"]
