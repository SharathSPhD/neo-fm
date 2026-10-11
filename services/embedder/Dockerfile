FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Bake the model into the image: no download at cold start, no Hugging Face dependency at runtime.
COPY fetch_model.py .
RUN python fetch_model.py
COPY app.py .
ENV PORT=8080 MODEL_DIR=/models
CMD exec uvicorn app:app --host 0.0.0.0 --port ${PORT} --workers 1
