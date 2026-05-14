# neo-fm dgx-worker container
#
# Phase 0: print-loop stub so the container builds and `docker compose up` runs.
# Phase 4: real pgmq poller (psycopg) that fetches jobs, calls music-inference,
#          uploads via signed PUT to Supabase Storage, and updates job rows.
# Phase 8: nvidia-smi-aware governor + priority queue.

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
