#!/usr/bin/env python3
"""GPU governor operator CLI (ADR 0011).

The dgx-worker reads its pre-emption state from a tiny JSON file on
the shared filesystem (default ``/var/run/neo-fm/governor.state``).
This script is the operator-side writer. It is intentionally minimal
so it can run on the DGX without a virtualenv.

Usage examples
--------------

  # Pause new pgmq reads; let any in-flight song finish. SIGTERM the
  # worker after 120 seconds even if the song hasn't finished.
  neo-fm-governor.py pause --tenant llm-ft-7b --drain-seconds 120

  # Block-until-drained variant: pauses, then polls the worker's
  # `jobs.lease_renewed_at` until no row is `processing` (or the
  # deadline fires), then exits. Useful from shell pipelines.
  neo-fm-governor.py drain --tenant llm-ft-7b --drain-seconds 120 \\
      --dsn "$PG_DSN"

  # Resume the worker.
  neo-fm-governor.py resume

  # Show current state.
  neo-fm-governor.py status

The CLI never SIGTERMs the worker container itself. After
``drain --deadline-fires`` returns non-zero, the operator's runbook
is expected to ``docker kill -s SIGTERM`` (or systemctl stop) the
worker. ADR 0011 §5 step 5 describes the protocol.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path

# Default path matches services/dgx-worker/app/governor.py.
DEFAULT_STATE_PATH = Path(
    os.environ.get("GOVERNOR_STATE_PATH", "/var/run/neo-fm/governor.state"),
)


@dataclass(frozen=True, slots=True)
class State:
    stop_new_jobs: bool
    drain_deadline_ms: int | None
    tenant: str | None


def _read_state(path: Path) -> State:
    if not path.exists():
        return State(False, None, None)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return State(False, None, None)
    if not isinstance(payload, dict):
        return State(False, None, None)
    deadline = payload.get("drain_deadline")
    try:
        deadline_ms = int(deadline) if deadline is not None else None
    except (TypeError, ValueError):
        deadline_ms = None
    return State(
        bool(payload.get("stop_new_jobs", False)),
        deadline_ms,
        (str(payload["tenant"]) if "tenant" in payload and payload["tenant"] else None),
    )


def _atomic_write(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def cmd_pause(args: argparse.Namespace) -> int:
    deadline_ms: int | None = None
    if args.drain_seconds is not None:
        deadline_ms = int(time.time() * 1000) + int(args.drain_seconds) * 1000
    payload: dict[str, object] = {"stop_new_jobs": True}
    if deadline_ms is not None:
        payload["drain_deadline"] = deadline_ms
    if args.tenant:
        payload["tenant"] = args.tenant
    _atomic_write(args.state_path, payload)
    print(
        json.dumps(
            {
                "ok": True,
                "stop_new_jobs": True,
                "drain_deadline_ms": deadline_ms,
                "tenant": args.tenant,
                "state_path": str(args.state_path),
            },
        ),
    )
    return 0


def cmd_resume(args: argparse.Namespace) -> int:
    if args.state_path.exists():
        args.state_path.unlink()
    print(json.dumps({"ok": True, "stop_new_jobs": False}))
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    state = _read_state(args.state_path)
    print(
        json.dumps(
            {
                "stop_new_jobs": state.stop_new_jobs,
                "drain_deadline_ms": state.drain_deadline_ms,
                "tenant": state.tenant,
                "state_path": str(args.state_path),
            },
        ),
    )
    return 0


def _count_processing(dsn: str) -> int:
    try:
        import psycopg  # type: ignore[import-not-found]
    except ImportError:
        print(
            "drain requires `psycopg` on PATH; install it or skip --dsn",
            file=sys.stderr,
        )
        return -1
    with psycopg.connect(dsn, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT count(*)
              FROM public.jobs
             WHERE status = 'processing'
               AND lease_renewed_at > now() - INTERVAL '90 seconds'
            """,
        )
        row = cur.fetchone()
    return int(row[0]) if row else 0


def cmd_drain(args: argparse.Namespace) -> int:
    cmd_pause(args)
    if not args.dsn:
        print("no --dsn passed; pause is set but no live drain check", file=sys.stderr)
        return 0
    deadline = time.time() + int(args.drain_seconds or 120)
    while time.time() < deadline:
        in_flight = _count_processing(args.dsn)
        if in_flight < 0:
            return 2
        if in_flight == 0:
            print(json.dumps({"ok": True, "drained": True, "elapsed_seconds": round(time.time() - (deadline - int(args.drain_seconds or 120)), 1)}))
            return 0
        time.sleep(args.poll_seconds)
    print(
        json.dumps(
            {
                "ok": False,
                "drained": False,
                "reason": "drain_deadline_exceeded",
                "runbook": "docker kill -s SIGTERM neo-fm-dgx-worker",
            },
        ),
    )
    return 3


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="neo-fm-governor",
        description=__doc__.splitlines()[0],
    )
    parser.add_argument(
        "--state-path",
        type=Path,
        default=DEFAULT_STATE_PATH,
        help=f"Path to the governor state file (default: {DEFAULT_STATE_PATH}).",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_pause = sub.add_parser("pause", help="Tell the worker to stop reading new jobs.")
    p_pause.add_argument("--tenant", type=str, default=None, help="Who is claiming the GPU.")
    p_pause.add_argument(
        "--drain-seconds",
        type=int,
        default=120,
        help="Embed a drain deadline (unix-ms) so the worker / runbook know when to SIGTERM.",
    )
    p_pause.set_defaults(func=cmd_pause)

    p_resume = sub.add_parser("resume", help="Clear the pre-emption flag.")
    p_resume.set_defaults(func=cmd_resume)

    p_status = sub.add_parser("status", help="Print the current state as JSON.")
    p_status.set_defaults(func=cmd_status)

    p_drain = sub.add_parser(
        "drain",
        help="Pause + poll `jobs` until no row is processing (or deadline fires).",
    )
    p_drain.add_argument("--tenant", type=str, default=None)
    p_drain.add_argument("--drain-seconds", type=int, default=120)
    p_drain.add_argument(
        "--dsn",
        type=str,
        default=os.environ.get("PG_DSN"),
        help="Postgres DSN used to read public.jobs. Defaults to $PG_DSN.",
    )
    p_drain.add_argument(
        "--poll-seconds",
        type=float,
        default=2.0,
        help="Polling interval for the drain check.",
    )
    p_drain.set_defaults(func=cmd_drain)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
