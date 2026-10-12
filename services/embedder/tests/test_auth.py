import hashlib
import hmac
import os
import sys
import time
from pathlib import Path

os.environ["EMBED_TOKEN"] = "master"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app  # noqa: E402


def scoped(exp: int, key: str = "master") -> str:
    return f"v1.{exp}." + hmac.new(key.encode(), f"v1.{exp}".encode(), hashlib.sha256).hexdigest()


def test_master_and_scoped_tokens() -> None:
    assert app._authorized("master")
    assert app._authorized(scoped(int(time.time()) + 60))


def test_rejects_expired_forged_and_empty() -> None:
    assert not app._authorized("")
    assert not app._authorized("nope")
    assert not app._authorized(scoped(int(time.time()) - 5))
    assert not app._authorized(scoped(int(time.time()) + 60, key="other"))
    assert not app._authorized("v1.9999999999.deadbeef")


def scoped_v2(exp: int, scope: str = "job_1", key: str = "master") -> str:
    return f"v2.{exp}.{scope}." + hmac.new(key.encode(), f"v2.{exp}.{scope}".encode(), hashlib.sha256).hexdigest()


def test_job_bound_v2_tokens() -> None:
    assert app._authorized(scoped_v2(int(time.time()) + 60))
    assert not app._authorized(scoped_v2(int(time.time()) - 5))
    assert not app._authorized(scoped_v2(int(time.time()) + 60, key="other"))
    # the scope is part of the signature: swapping it invalidates the token
    tampered = scoped_v2(int(time.time()) + 60).replace("job_1", "job_2")
    assert not app._authorized(tampered)
