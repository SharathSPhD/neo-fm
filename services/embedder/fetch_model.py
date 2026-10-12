"""Build-time: copy the ONNX model + tokenizer into /models (baked into the image). EMBED_MODEL=gemma|e5."""
import os
import shutil

from huggingface_hub import hf_hub_download

family = os.environ.get("EMBED_MODEL", "gemma")
os.makedirs("/models", exist_ok=True)
if family == "gemma":
    repo, files = "onnx-community/embeddinggemma-300m-ONNX", ["onnx/model_quantized.onnx", "onnx/model_quantized.onnx_data", "tokenizer.json"]
else:
    repo, files = "Xenova/multilingual-e5-small", ["onnx/model_quantized.onnx", "tokenizer.json"]
for remote in files:
    shutil.copy(hf_hub_download(repo, remote), f"/models/{os.path.basename(remote)}")
