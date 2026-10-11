FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Bake the model into the image: no download at cold start, no Hugging Face dependency at runtime.
RUN python - <<'PY'
from huggingface_hub import hf_hub_download
import shutil, os
os.makedirs("/models", exist_ok=True)
for remote, local in (("onnx/model_quantized.onnx", "model_quantized.onnx"), ("tokenizer.json", "tokenizer.json")):
    shutil.copy(hf_hub_download("Xenova/multilingual-e5-small", remote), f"/models/{local}")
PY
COPY app.py .
ENV PORT=8080 MODEL_DIR=/models
CMD exec uvicorn app:app --host 0.0.0.0 --port ${PORT} --workers 1
