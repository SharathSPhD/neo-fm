"""Parses every fixture under `packages/song-doc/fixtures/` through
`SongDocument` (pydantic) and prints a normalised JSON document (sorted
keys) to stdout, one fixture per line as:

    {fixture-name}\t{normalised-json}

The TypeScript equivalent at `packages/song-doc/scripts/normalize-fixtures.ts`
produces an identical text stream. The CI parity job diffs them; any
difference is a Zod/pydantic drift bug and fails the build.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from neo_fm_song_doc import SongDocument

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "fixtures"


def main() -> int:
    files = sorted(FIXTURE_DIR.glob("*.json"), key=lambda p: p.name)
    for path in files:
        raw = json.loads(path.read_text(encoding="utf-8"))
        doc = SongDocument.model_validate(raw)
        # exclude_none drops optional-unset fields. Without it, pydantic would
        # emit them as `null`, but Zod's TS parsed output omits them, so the
        # parity stream would diverge for no real reason.
        normalised = doc.model_dump(mode="json", exclude_none=True)
        line = json.dumps(
            normalised, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        )
        sys.stdout.write(f"{path.name}\t{line}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
