# neo-fm vocal-synth container — Phase 5+ real impl.
#
# Indic singing voice synthesis (kenpath/svara-tts-v1 or Indic Parler).
# Boots into a FakeVocalModel fallback when no weights are present so
# docker compose stays usable on machines without GPU.

# nvcr.io/nvidia/pytorch ships torch+CUDA matched to the host driver,
# which is what we want on the DGX. CI builds skip this image and
# install only the slim runtime via the alt target below.
FROM nvcr.io/nvidia/pytorch:24.08-py3 AS dgx

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY pyproject.toml README.md ./
COPY app ./app

RUN pip install --no-cache-dir -e ".[tts]"

EXPOSE 8089
CMD ["uvicorn", "app.serve:app", "--host", "0.0.0.0", "--port", "8089"]


# CI / local-no-GPU target: lighter, no torch+CUDA.
FROM python:3.12-slim AS ci

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY pyproject.toml README.md ./
COPY app ./app

RUN pip install --no-cache-dir -e .

EXPOSE 8089
CMD ["uvicorn", "app.serve:app", "--host", "0.0.0.0", "--port", "8089"]
