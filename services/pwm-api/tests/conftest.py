"""Make ``serve`` importable when pytest is invoked from the service
root or with ``uv run pytest``. The service is intentionally not a
package (single-file ``serve.py``), so we insert the parent dir on
sys.path before any test module imports it."""

from __future__ import annotations

import sys
from pathlib import Path

_SERVICE_DIR = Path(__file__).resolve().parent.parent
if str(_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVICE_DIR))
