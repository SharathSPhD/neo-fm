"""Render 10-second voice previews for the v1.4 voice catalogue.

Usage (DGX-Spark only; HuggingFace Hub is download-only):

    uv run --extra parler python scripts/render_voice_previews.py \\
        --out-dir /tmp/voice-previews \\
        [--upload  # also push to Supabase Storage bucket voice-samples]

What it does
============
Walks `app/voice_catalog.json` and, for each entry, builds a one-section
:class:`VocalRequest` whose lyrics are a 10-second "Hello world" line
in the entry's language. It then runs the routed vocal-synth pipeline
(currently always Parler) and writes the resulting WAV to
``{out_dir}/{voice_id}.wav`` and, optionally, uploads it to the public
``voice-samples`` Supabase Storage bucket under ``samples/<voice_id>.wav``.

This is an operator script -- it lives on DGX, talks to local
Parler/Svara backends, and only needs network for the Supabase upload
step.

The script is intentionally minimal: no progress bar, no parallelism,
no retry. Re-running is safe (existing objects are overwritten) and
each preview takes only a few seconds on the Grace Blackwell GB10.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

# Make `app` importable when running from the repo root.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.model import FakeVocalModel, VocalRequest, VocalSection  # noqa: E402
from app.routing import RoutingVocalModel  # noqa: E402
from app.voice_catalog import VOICES  # noqa: E402

if TYPE_CHECKING:
    pass


PREVIEW_SECONDS = 10
SAMPLE_RATE = 48_000


# One short, language-appropriate line per language. Kept tiny so the
# preview is mostly the voice character, not the lyric.
PREVIEW_LYRICS: dict[str, str] = {
    "en": "Hello, welcome to neo dot f m",
    "hi": "नमस्ते, मैं तुम्हारी आवाज़ हूँ",
    "kn": "ಕನ್ನಡದ ಸ್ವರಕ್ಕೆ ಸ್ವಾಗತ",
    "ta": "வணக்கம், என் குரலை கேளுங்கள்",
    "te": "నమస్తే, నా స్వరం వినండి",
    "bn": "নমস্কার, আমার কণ্ঠস্বর শুনুন",
    "sa": "ॐ शान्ति शान्ति शान्तिः",
}


def _build_request(voice_id: str) -> VocalRequest:
    entry = VOICES[voice_id]
    lyric = PREVIEW_LYRICS.get(entry.language, PREVIEW_LYRICS["en"])
    section = VocalSection(
        id="preview",
        type="verse",
        lyrics=lyric,
        language=entry.language,
        script=None,
        transliteration=None,
        target_seconds=PREVIEW_SECONDS,
        tempo_bpm=80,
        raga_name=None,
        voice_timbre=entry.gender if entry.gender != "androgynous" else "androgynous",
        voice_id=voice_id,
    )
    return VocalRequest(
        job_id="preview-render",
        attempt_id=None,
        trace_id=None,
        language=entry.language,
        style_family="western",  # neutral style; voice prompt does the work
        voice_timbre=section.voice_timbre,
        sample_rate=SAMPLE_RATE,
        sections=[section],
        target_duration_seconds=PREVIEW_SECONDS,
    )


def _upload(wav_bytes: bytes, voice_id: str) -> None:
    """Upload the rendered WAV to the public ``voice-samples`` bucket.

    Uses the Supabase Storage REST API directly via stdlib `urllib` so
    the operator doesn't have to install `supabase-py` (which pulls
    httpx/postgrest as transitive deps). Idempotent: ``x-upsert: true``
    overwrites any existing object at the path.
    """
    import urllib.error
    import urllib.request

    base_url = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    path = f"samples/{voice_id}.wav"
    upload_url = f"{base_url.rstrip('/')}/storage/v1/object/voice-samples/{path}"
    req = urllib.request.Request(
        upload_url,
        data=wav_bytes,
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "audio/wav",
            "x-upsert": "true",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"upload {path} failed: {e.code} {body}") from e
    print(f"  uploaded -> voice-samples/{path}", flush=True)


def _upload_manifest(manifest: dict[str, object]) -> None:
    """Upload voice-samples/manifest.json so the web picker can gate fake previews."""
    import urllib.error
    import urllib.request

    base_url = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    payload = json.dumps(manifest, indent=2).encode()
    upload_url = f"{base_url.rstrip('/')}/storage/v1/object/voice-samples/manifest.json"
    req = urllib.request.Request(
        upload_url,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "x-upsert": "true",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"manifest upload failed: {e.code} {body}") from e
    print("  uploaded -> voice-samples/manifest.json", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out-dir",
        type=Path,
        required=True,
        help="Local directory for the rendered WAVs.",
    )
    parser.add_argument(
        "--upload",
        action="store_true",
        help="Also upload each WAV to the voice-samples Supabase bucket.",
    )
    parser.add_argument(
        "--only",
        type=str,
        default=None,
        help="Optional voice_id to render in isolation (debugging).",
    )
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    # On DGX we use the RoutingVocalModel which lazily loads svara /
    # parler / indicf5 / nemo per-section and falls back to the fake
    # backend when the real model isn't loadable. Off-DGX operators
    # (this script as a CI / dev tool) get the FakeVocalModel directly
    # so they don't need transformers + torch installed -- the fake
    # produces a deterministic vowel-shaped tone that's playable for
    # UI smoke checks, while still being clearly synthetic.
    require_real = os.environ.get("NEO_FM_REQUIRE_REAL_MODEL") == "1"
    model: RoutingVocalModel | FakeVocalModel
    if require_real:
        model = RoutingVocalModel()
    else:
        model = FakeVocalModel()

    voice_ids = [args.only] if args.only else sorted(VOICES.keys())
    manifest: dict[str, object] = {}
    for vid in voice_ids:
        if vid not in VOICES:
            print(f"skipping unknown voice_id: {vid}", file=sys.stderr)
            continue
        print(f"rendering {vid}...", flush=True)
        req = _build_request(vid)
        wav = model.synthesise(req)
        out_path = args.out_dir / f"{vid}.wav"
        out_path.write_bytes(wav)
        print(f"  wrote {out_path}", flush=True)
        manifest[vid] = {
            "byte_size": len(wav),
            "sha256": hashlib.sha256(wav).hexdigest(),
            "rendered_at": datetime.now(timezone.utc).isoformat(),
            "is_real": require_real,
        }
        if args.upload:
            _upload(wav, vid)
    if args.upload:
        _upload_manifest({"voices": manifest, "generated_at": datetime.now(timezone.utc).isoformat()})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
