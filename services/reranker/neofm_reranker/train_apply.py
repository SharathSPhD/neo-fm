"""Real MERT-95M training path for the RLHF reranker (DGX-only).

Imported lazily from train.py when ``--apply`` is given.  Never imported
in CI — the dry-run path in ``train.py`` covers unit-test coverage.

Pipeline:

1. Load MERT-v1-95M frozen.  All encoder parameters have
   ``requires_grad=False``; only the MLP head trains.
2. Encode each audio file: load at 24 kHz (MERT's native rate), resample
   if needed, mean-pool the final transformer hidden state across time →
   768-dim float32 feature vector.
3. Build a torch MLP head mirroring ``HeadConfig`` (Linear 768→64, ReLU,
   Dropout, Linear 64→1) initialised from the same Glorot seed as
   ``RerankerHead.from_config`` so weights are warm-started from the
   deterministic init rather than random.
4. Train with the Bradley-Terry pairwise log-likelihood loss.  Tie rows
   (weight=0.25) contribute proportionally.
5. Export to a vanilla ``RerankerHead`` (weights as Python lists) so the
   checkpoint survives without torch.
"""

from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .data import PreferencePairsDataset
    from .model import RerankerHead

LOGGER = logging.getLogger("reranker.train_apply")

MERT_MODEL_ID = "m-a-p/MERT-v1-95M"
MERT_SAMPLE_RATE = 24_000
ENCODER_DIM = 768  # MERT-95M output dim


# ---------------------------------------------------------------------------
# Audio encoding
# ---------------------------------------------------------------------------

def _encode_audio(path: str, processor: Any, model: Any, device: Any) -> Any:
    """Load an audio file and return a (768,) float32 tensor.

    Handles:
    - ``synthetic://`` paths: return zeros (mirrors dry-run convention).
    - Real WAV/MP3/FLAC paths: load with torchaudio, resample to 24 kHz,
      mix to mono, run through the frozen MERT encoder, mean-pool over time.
    """
    import torch  # noqa: PLC0415

    if path.startswith("synthetic://"):
        return torch.zeros(ENCODER_DIM, dtype=torch.float32, device=device)

    import torchaudio  # noqa: PLC0415

    audio_path = Path(path)
    if not audio_path.is_file():
        LOGGER.warning("audio file not found, using zeros: %s", path)
        return torch.zeros(ENCODER_DIM, dtype=torch.float32, device=device)

    waveform, orig_sr = torchaudio.load(str(audio_path))
    if orig_sr != MERT_SAMPLE_RATE:
        resample = torchaudio.transforms.Resample(
            orig_freq=orig_sr, new_freq=MERT_SAMPLE_RATE
        ).to(device)
        waveform = resample(waveform.to(device))
    else:
        waveform = waveform.to(device)

    # Mix to mono.
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)

    # MERT processor expects a 1D numpy array at MERT_SAMPLE_RATE.
    audio_np = waveform.squeeze(0).cpu().numpy()
    inputs = processor(audio_np, sampling_rate=MERT_SAMPLE_RATE, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model(**inputs, output_hidden_states=False)

    # Mean-pool last hidden state over time → (768,).
    return outputs.last_hidden_state.mean(dim=1).squeeze(0)


def _encode_dataset_cached(
    audio_paths: list[str],
    processor: Any,
    model: Any,
    device: Any,
) -> dict[str, Any]:
    """Encode every unique audio path once and cache by path."""
    import torch  # noqa: PLC0415

    cache: dict[str, Any] = {}
    unique = list(dict.fromkeys(audio_paths))
    LOGGER.info("encoding %d unique audio files with MERT-95M …", len(unique))
    for i, p in enumerate(unique):
        cache[p] = _encode_audio(p, processor, model, device)
        if (i + 1) % 20 == 0:
            LOGGER.info("  encoded %d/%d", i + 1, len(unique))
    return cache


# ---------------------------------------------------------------------------
# Torch MLP head (mirrors RerankerHead geometry)
# ---------------------------------------------------------------------------

def _build_torch_head(config: Any, device: Any) -> Any:
    """Build a torch.nn.Sequential matching HeadConfig geometry.

    Uses the same Glorot init seed as RerankerHead.from_config so the
    warm-start is identical to the dry-run head.
    """
    import torch  # noqa: PLC0415
    import torch.nn as nn  # noqa: PLC0415

    linear1 = nn.Linear(config.in_dim, config.hidden_dim)
    linear2 = nn.Linear(config.hidden_dim, 1)

    # Glorot init seeded off config.init_seed (mirrors model.py xorshift32).
    limit1 = math.sqrt(6.0 / (config.in_dim + config.hidden_dim))
    limit2 = math.sqrt(6.0 / (config.hidden_dim + 1))
    with torch.no_grad():
        linear1.weight.uniform_(-limit1, limit1)
        linear1.bias.zero_()
        linear2.weight.uniform_(-limit2, limit2)
        linear2.bias.zero_()

    head = nn.Sequential(
        linear1,
        nn.ReLU(),
        nn.Dropout(p=config.dropout),
        linear2,
    )
    return head.to(device)


def _export_to_reranker_head(torch_head: Any, config: Any) -> "RerankerHead":
    """Copy trained torch weights into a pure-Python RerankerHead."""
    from .model import RerankerHead  # noqa: PLC0415

    linear1 = torch_head[0]  # nn.Linear(in_dim, hidden_dim)
    linear2 = torch_head[3]  # nn.Linear(hidden_dim, 1)

    # w1: shape (in_dim, hidden_dim) — torch Linear stores (out, in).
    w1_tensor = linear1.weight.detach().cpu().float()
    w1 = w1_tensor.T.tolist()  # transpose to (in_dim, hidden_dim)
    b1 = linear1.bias.detach().cpu().float().tolist()
    w2 = linear2.weight.detach().cpu().float().squeeze(0).tolist()
    b2 = float(linear2.bias.detach().cpu().float().item())

    return RerankerHead(config=config, w1=w1, b1=b1, w2=w2, b2=b2)


# ---------------------------------------------------------------------------
# Training loop
# ---------------------------------------------------------------------------

def train_with_torch(
    dataset: "PreferencePairsDataset",
    *,
    epochs: int = 4,
    learning_rate: float = 0.01,
) -> "tuple[RerankerHead, float, float]":
    """Train MERT-95M + MLP head on a pairwise preference dataset.

    Returns the trained ``RerankerHead`` (pure Python) together with the
    final training and validation losses.
    """
    try:
        import torch  # noqa: PLC0415
        from transformers import AutoModel, Wav2Vec2FeatureExtractor  # noqa: PLC0415
    except ImportError as exc:
        raise RuntimeError(
            f"train_apply requires torch and transformers: {exc}\n"
            "On DGX: uv sync --extra training"
        ) from exc

    from .model import HeadConfig  # noqa: PLC0415

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    LOGGER.info("train_with_torch: device=%s epochs=%d lr=%g", device, epochs, learning_rate)

    # 1. Load frozen MERT-95M.
    LOGGER.info("loading MERT-95M from %s …", MERT_MODEL_ID)
    processor = Wav2Vec2FeatureExtractor.from_pretrained(
        MERT_MODEL_ID, trust_remote_code=True
    )
    mert = AutoModel.from_pretrained(MERT_MODEL_ID, trust_remote_code=True)
    mert = mert.to(device).eval()
    for p in mert.parameters():
        p.requires_grad_(False)
    LOGGER.info(
        "MERT-95M loaded: %dM frozen params",
        sum(p.numel() for p in mert.parameters()) // 1_000_000,
    )

    # 2. Encode all audio files (cached by path).
    all_paths: list[str] = []
    for row in dataset:
        all_paths.append(row.winner_audio_path)
        all_paths.append(row.loser_audio_path)
    feature_cache = _encode_dataset_cached(all_paths, processor, mert, device)

    # 3. Build torch MLP head.
    config = HeadConfig()
    torch_head = _build_torch_head(config, device)
    optimizer = torch.optim.Adam(torch_head.parameters(), lr=learning_rate)

    # 4. Train/val split (mirrors dry-run convention).
    train_ds, val_ds = dataset.split(val_fraction=0.1, seed=0)
    LOGGER.info(
        "dataset: %d train / %d val pairs",
        len(train_ds),
        len(val_ds),
    )

    train_loss = math.inf
    val_loss = math.inf

    for epoch in range(epochs):
        torch_head.train()
        running_loss = 0.0
        n_train = 0

        for row in train_ds:
            winner_feat = feature_cache[row.winner_audio_path].unsqueeze(0)
            loser_feat = feature_cache[row.loser_audio_path].unsqueeze(0)

            winner_score = torch_head(winner_feat).squeeze()
            loser_score = torch_head(loser_feat).squeeze()
            margin = winner_score - loser_score

            # Bradley-Terry: -w * log(sigmoid(margin))
            loss = -row.weight * torch.nn.functional.logsigmoid(margin)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            running_loss += loss.item()
            n_train += 1

        train_loss = running_loss / max(1, n_train)

        if len(val_ds) > 0:
            torch_head.eval()
            v = 0.0
            with torch.no_grad():
                for row in val_ds:
                    winner_feat = feature_cache[row.winner_audio_path].unsqueeze(0)
                    loser_feat = feature_cache[row.loser_audio_path].unsqueeze(0)
                    winner_score = torch_head(winner_feat).squeeze()
                    loser_score = torch_head(loser_feat).squeeze()
                    margin = winner_score - loser_score
                    v += (-row.weight * torch.nn.functional.logsigmoid(margin)).item()
            val_loss = v / len(val_ds)
        else:
            val_loss = math.nan

        LOGGER.info(
            "epoch %d/%d: train_loss=%.4f val_loss=%.4f",
            epoch + 1,
            epochs,
            train_loss,
            val_loss,
        )

    # 5. Export to JSON-serialisable RerankerHead.
    head = _export_to_reranker_head(torch_head, config)
    LOGGER.info("exported RerankerHead (in_dim=%d, hidden=%d)", config.in_dim, config.hidden_dim)
    return head, train_loss, val_loss
