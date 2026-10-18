# Build from the REPO ROOT (the engine lives in managed-agents/pce-engine):
#   gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT/REPO/neo-fm-pce-cascade -f services/pce-cascade/Dockerfile .   (or docker build -f ... .)
FROM python:3.11-slim
WORKDIR /app
COPY services/pce-cascade/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY managed-agents/pce-engine /app/engine
COPY services/pce-cascade/app.py .
ENV PORT=8080 ENGINE_DIR=/app/engine
CMD exec uvicorn app:app --host 0.0.0.0 --port ${PORT} --workers 1
