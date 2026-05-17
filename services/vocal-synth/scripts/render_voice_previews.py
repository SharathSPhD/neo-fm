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
import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING

# Make `app` importable when running from the repo root.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.model import VocalRequest, VocalSection  # noqa: E402
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
    "hi": "नमस्ते, मैं तुम्हारी आवाज़ हूँ",  # noqa: RUF001
    "kn": "ಕನ್ನಡದ ಸ್ವರಕ್ಕೆ ಸ್ವಾಗತ",
    "ta": "வணக்கம், என் குரலை கேளுங்கள்",
    "te": "నమస్తే, నా స్వరం వినండి",
    "bn": "নমস্কার, আমার কণ্ঠস্বর শুনুন",
    "sa": "ॐ शान्ति शान्ति शान्तिः",  # noqa: RUF001
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
    # Lazy import: only operators with the upload extra need supabase-py.
    from supabase import create_client  # type: ignore[import-not-found]

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(url, key)
    path = f"samples/{voice_id}.wav"
    sb.storage.from_("voice-samples").upload(
        path=path,
        file=wav_bytes,
        file_options={"content-type": "audio/wav", "upsert": "true"},
    )
    print(f"  uploaded -> voice-samples/{path}", flush=True)


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
    model = RoutingVocalModel()
    model.load()

    voice_ids = [args.only] if args.only else sorted(VOICES.keys())
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
        if args.upload:
            _upload(wav, vid)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
