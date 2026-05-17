# neo-fm cover-art-synth — v1.3 Sprint 3.
#
# Internal FastAPI sidecar. Z-Image-Turbo / SDXL-Turbo diffusion. The DGX
# build inherits torch+CUDA from the nvcr image; the CI build skips
# the diffusion dependencies and runs against the FakeCoverArtModel.

FROM nvcr.io/nvidia/pytorch:24.08-py3 AS dgx

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY pyproject.toml README.md ./
COPY app ./app

RUN pip install --no-cache-dir -e ".[diffusion]"

EXPOSE 8090
CMD ["uvicorn", "app.serve:app", "--host", "0.0.0.0", "--port", "8090"]


FROM python:3.12-slim AS ci

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY pyproject.toml README.md ./
COPY app ./app

RUN pip install --no-cache-dir -e .

EXPOSE 8090
CMD ["uvicorn", "app.serve:app", "--host", "0.0.0.0", "--port", "8090"]
