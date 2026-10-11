"""Build-time: copy the ONNX model + tokenizer into /models (baked into the image)."""
import os
import shutil

from huggingface_hub import hf_hub_download

os.makedirs("/models", exist_ok=True)
for remote, local in (("onnx/model_quantized.onnx", "model_quantized.onnx"), ("tokenizer.json", "tokenizer.json")):
    shutil.copy(hf_hub_download("Xenova/multilingual-e5-small", remote), f"/models/{local}")
