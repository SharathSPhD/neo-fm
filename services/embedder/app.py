"""neo-fm embedder: multilingual-e5-small (ONNX, int8) behind a tiny HTTP API.

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
MODEL_ID = "multilingual-e5-small"
MAX_TEXTS, MAX_CHARS, MAX_TOKENS = 64, 2000, 256

app = FastAPI(title="neo-fm embedder")


@lru_cache(maxsize=1)
def _engine() -> tuple[ort.InferenceSession, Tokenizer]:
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = int(os.environ.get("ORT_THREADS", "2"))
    sess = ort.InferenceSession(os.path.join(MODEL_DIR, "model_quantized.onnx"), opts, providers=["CPUExecutionProvider"])
    tok = Tokenizer.from_file(os.path.join(MODEL_DIR, "tokenizer.json"))
    tok.enable_truncation(max_length=MAX_TOKENS)
    tok.enable_padding(pad_id=tok.token_to_id("<pad>") or 1, pad_token="<pad>")
    return sess, tok


def embed(texts: list[str], kind: str) -> np.ndarray:
    sess, tok = _engine()
    prefix = "query: " if kind == "query" else "passage: "  # e5 expects these prefixes
    enc = tok.encode_batch([prefix + t for t in texts])
    ids = np.array([e.ids for e in enc], dtype=np.int64)
    mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
    feeds = {"input_ids": ids, "attention_mask": mask}
    if any(i.name == "token_type_ids" for i in sess.get_inputs()):
        feeds["token_type_ids"] = np.zeros_like(ids)
    hidden = sess.run(None, feeds)[0]  # [batch, seq, dim]
    m = mask[..., None].astype(np.float32)
    pooled = (hidden * m).sum(1) / np.clip(m.sum(1), 1e-9, None)  # mean pooling
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
    kind: str = "passage"


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
