"""GPU governor coordination — read side (worker).

ADR 0011 introduces a cooperative pre-emption protocol between the
GPU governor (an operator-controlled process on the DGX) and this
worker. The shared contract is a small JSON file at
``/var/run/neo-fm/governor.state`` containing three fields:

  - ``stop_new_jobs: bool``   — when true, this worker MUST NOT call
    ``pgmq.read``. In-flight jobs are allowed to finish (their
    heartbeat keeps the lease alive per ADR 0008).
  - ``drain_deadline: int?``  — optional unix-ms deadline; the
    governor will SIGTERM the worker at this time if a job is still
    in flight.
  - ``tenant: str?``          — who is asking. Logged by the worker
    so the operator dashboard sees who paused us.

The worker side is intentionally tiny: read the file at the top of
each main-loop iteration, return a typed view. If the file is
missing, malformed, or unreadable, we assume the governor isn't
managing this box and behave as if ``stop_new_jobs=false``. This is
the safe default — false-positives would let a co-tenant starve
real songs.

Implementation notes
--------------------
- File I/O is sync and cheap (a few hundred bytes); we don't bother
  caching. The main loop already polls every ``poll_interval_seconds``
  so the read frequency is bounded.
- We never *write* this file from the worker. The CLI in
  ``scripts/neo-fm-governor.py`` is the operator-side writer.
- ``inference_preempted`` (ADR 0011 §3) is recorded by the worker
  when the SIGTERM handler fires while a job is in flight. See
  ``worker.py``.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path

LOG = logging.getLogger("neo_fm.dgx_worker.governor")

DEFAULT_STATE_PATH = Path(
    os.environ.get("GOVERNOR_STATE_PATH", "/var/run/neo-fm/governor.state"),
)


@dataclass(frozen=True, slots=True)
class GovernorState:
    """Decoded snapshot of the governor's shared state file.

    Defaults represent the no-governor case: accept new jobs, no
    drain deadline, no tenant.
    """

    stop_new_jobs: bool = False
    drain_deadline_ms: int | None = None
    tenant: str | None = None

    @property
    def is_paused(self) -> bool:
        """True iff the governor has asked us not to accept new jobs."""
        return self.stop_new_jobs


def read_state(path: Path | None = None) -> GovernorState:
    """Read the governor state file.

    Returns ``GovernorState()`` (the no-governor default) if the file
    doesn't exist, is unreadable, or contains malformed JSON. We log
    at WARNING for malformed payloads so an operator typo is visible,
    but never raise — the worker must always be able to keep running.
    """
    target = path if path is not None else DEFAULT_STATE_PATH
    if not target.exists():
        return GovernorState()
    try:
        raw = target.read_text(encoding="utf-8")
    except OSError as exc:
        LOG.warning("governor_state_read_failed", extra={"path": str(target), "err": str(exc)})
        return GovernorState()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        LOG.warning("governor_state_malformed", extra={"path": str(target), "err": str(exc)})
        return GovernorState()
    if not isinstance(payload, dict):
        LOG.warning("governor_state_wrong_shape", extra={"path": str(target)})
        return GovernorState()

    stop_new_jobs = bool(payload.get("stop_new_jobs", False))
    raw_deadline = payload.get("drain_deadline")
    drain_deadline_ms: int | None
    if raw_deadline is None:
        drain_deadline_ms = None
    else:
        try:
            drain_deadline_ms = int(raw_deadline)
        except (TypeError, ValueError):
            LOG.warning(
                "governor_state_bad_deadline",
                extra={"path": str(target), "value": raw_deadline},
            )
            drain_deadline_ms = None
    tenant = payload.get("tenant")
    if tenant is not None and not isinstance(tenant, str):
        tenant = str(tenant)
    return GovernorState(
        stop_new_jobs=stop_new_jobs,
        drain_deadline_ms=drain_deadline_ms,
        tenant=tenant,
    )


def write_state(
    path: Path,
    *,
    stop_new_jobs: bool,
    drain_deadline_ms: int | None = None,
    tenant: str | None = None,
) -> None:
    """Operator-side writer. Used by ``scripts/neo-fm-governor.py``.

    Writes atomically (write to ``<path>.tmp`` then rename) so the
    worker never reads a half-flushed file. Creates the parent
    directory if needed.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, object] = {"stop_new_jobs": bool(stop_new_jobs)}
    if drain_deadline_ms is not None:
        payload["drain_deadline"] = int(drain_deadline_ms)
    if tenant:
        payload["tenant"] = tenant
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def clear_state(path: Path) -> None:
    """Remove the governor state file. No-op if it already absent."""
    try:
        path.unlink()
    except FileNotFoundError:
        pass
