"""neo-fm embedder: EmbeddingGemma-300M (ONNX, int8) by default, multilingual-e5-small selectable (EMBED_MODEL=e5), behind a tiny HTTP API.

POST /embed  {"texts": ["..."], "kind": "passage"|"query"}  ->  {"model", "dim", "vectors": [[...]]}
GET  /health
Auth: `Authorization: Bearer <EMBED_TOKEN>` (shared secret; set as a Cloud Run env var).
Vectors are L2-normalised, so cosine == dot product. Stateless; the model is baked into the image.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import time
from functools import lru_cache

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from tokenizers import Tokenizer

MODEL_DIR = os.environ.get("MODEL_DIR", "/models")
FAMILY = os.environ.get("EMBED_MODEL", "gemma")  # "gemma" | "e5"
MODEL_ID = "embeddinggemma-300m" if FAMILY == "gemma" else "multilingual-e5-small"
MODEL_FILE = "model_quantized.onnx"
# Prompts: Gemma documents task-specific prefixes; e5 expects query:/passage:.
PREFIX = {
    "gemma": {"passage": "title: none | text: ", "query": "task: search result | query: ", "similarity": "task: sentence similarity | query: "},
    "e5": {"passage": "passage: ", "query": "query: ", "similarity": "query: "},
}[FAMILY]
MAX_TEXTS, MAX_CHARS, MAX_TOKENS = 64, 2000, 256

app = FastAPI(title="neo-fm embedder")


@lru_cache(maxsize=1)
def _engine() -> tuple[ort.InferenceSession, Tokenizer]:
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = int(os.environ.get("ORT_THREADS", "2"))
    sess = ort.InferenceSession(os.path.join(MODEL_DIR, MODEL_FILE), opts, providers=["CPUExecutionProvider"])
    tok = Tokenizer.from_file(os.path.join(MODEL_DIR, "tokenizer.json"))
    tok.enable_truncation(max_length=MAX_TOKENS)
    tok.enable_padding(pad_id=tok.token_to_id("<pad>") or 1, pad_token="<pad>")
    return sess, tok


def embed(texts: list[str], kind: str) -> np.ndarray:
    sess, tok = _engine()
    prefix = PREFIX.get(kind, PREFIX["passage"])
    enc = tok.encode_batch([prefix + t for t in texts])
    ids = np.array([e.ids for e in enc], dtype=np.int64)
    mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
    feeds = {"input_ids": ids, "attention_mask": mask}
    if any(i.name == "token_type_ids" for i in sess.get_inputs()):
        feeds["token_type_ids"] = np.zeros_like(ids)
    names = [o.name for o in sess.get_outputs()]
    outs = sess.run(None, feeds)
    if "sentence_embedding" in names:  # Gemma export already applies pooling + dense layers
        pooled = outs[names.index("sentence_embedding")]
    else:
        m = mask[..., None].astype(np.float32)
        pooled = (outs[0] * m).sum(1) / np.clip(m.sum(1), 1e-9, None)  # mean pooling
    pooled /= np.clip(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-9, None)
    return pooled.astype(np.float32)


def _authorized(given: str) -> bool:
    """Master token, or a short-lived scoped token `v1.<unix-exp>.<hex hmac-sha256(master, "v1.<exp>")>`.

    The app mints scoped tokens per job so the master secret never enters an agent sandbox.
    """
    master = os.environ.get("EMBED_TOKEN", "")
    if not master or not given:
        return False
    if hmac.compare_digest(given.encode(), master.encode()):
        return True
    parts = given.split(".")
    if len(parts) != 3 or parts[0] != "v1" or not parts[1].isdigit() or int(parts[1]) < time.time():
        return False
    want = hmac.new(master.encode(), f"v1.{parts[1]}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(parts[2].encode(), want.encode())


class Req(BaseModel):
    texts: list[str] = Field(min_length=1)
    kind: str = "similarity"  # similarity | passage | query


@app.get("/health")
def health() -> dict[str, str]:
    _engine()
    return {"ok": "true", "model": MODEL_ID}


@app.post("/embed")
def post_embed(req: Req, authorization: str | None = Header(default=None)) -> dict[str, object]:
    if not _authorized((authorization or "").removeprefix("Bearer ").strip()):
        raise HTTPException(status_code=401, detail="unauthorized")
    if len(req.texts) > MAX_TEXTS or any(len(t) > MAX_CHARS for t in req.texts):
        raise HTTPException(status_code=413, detail=f"max {MAX_TEXTS} texts of {MAX_CHARS} chars")
    vecs = embed(req.texts, req.kind)
    return {"model": MODEL_ID, "dim": int(vecs.shape[1]), "vectors": [[round(float(x), 6) for x in v] for v in vecs]}
