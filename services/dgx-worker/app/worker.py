"""
Phase 0 stub for the dgx-worker.

Prints a heartbeat every POLL_INTERVAL_SECONDS and exits cleanly on SIGTERM.
Real pgmq polling, music-inference invocation, and Supabase Storage upload land
in Phase 4. This stub exists so `docker compose up` boots both services and CI
verifies the container builds.
"""

from __future__ import annotations

import os
import signal
import sys
import time
from types import FrameType

POLL_INTERVAL_SECONDS = float(os.environ.get("POLL_INTERVAL_SECONDS", "5"))
PHASE = 0

_should_stop = False


def _handle_signal(signum: int, _frame: FrameType | None) -> None:
    global _should_stop
    print(f"[dgx-worker] received signal {signum}, shutting down", flush=True)
    _should_stop = True


def main() -> int:
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    print(
        f"[dgx-worker] phase={PHASE} stub started. "
        f"Real pgmq polling lands in Phase 4. Heartbeat every {POLL_INTERVAL_SECONDS}s.",
        flush=True,
    )

    tick = 0
    while not _should_stop:
        tick += 1
        print(
            f"[dgx-worker] tick={tick} phase=0 stub: pgmq client not wired yet",
            flush=True,
        )
        for _ in range(int(POLL_INTERVAL_SECONDS * 10)):
            if _should_stop:
                break
            time.sleep(0.1)

    print("[dgx-worker] stopped", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
