#!/usr/bin/env python3
"""Uploads a signed bundle to Google Play: internal track first, then a staged production rollout of the same build.

Uses the Android Publisher API v3 directly with a service account (env PLAY_SERVICE_ACCOUNT_JSON, the JSON itself).
Each step is its own edit so a failed production step leaves the internal release in place.
"""
import argparse
import json
import os
import sys

import requests
from google.auth.transport.requests import Request
from google.oauth2 import service_account

PKG = "com.neofm.app"
API = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PKG}"
UPLOAD = f"https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PKG}"


def session():
    info = json.loads(os.environ["PLAY_SERVICE_ACCOUNT_JSON"])
    creds = service_account.Credentials.from_service_account_info(info, scopes=["https://www.googleapis.com/auth/androidpublisher"])
    creds.refresh(Request())
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {creds.token}"
    return s


def check(r, what):
    if not r.ok:
        sys.exit(f"{what} failed: {r.status_code} {r.text[:400]}")
    return r.json() if r.text else {}


def new_edit(s):
    return check(s.post(f"{API}/edits", json={}), "create edit")["id"]


def commit(s, edit):
    check(s.post(f"{API}/edits/{edit}:commit"), "commit edit")


def set_track(s, edit, track, release):
    check(s.put(f"{API}/edits/{edit}/tracks/{track}", json={"track": track, "releases": [release]}), f"set {track} track")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--aab", required=True)
    ap.add_argument("--name", required=True, help="release name, e.g. 0.6.0")
    ap.add_argument("--production-fraction", type=float, default=0.2)
    ap.add_argument("--internal-only", action="store_true")
    args = ap.parse_args()

    s = session()
    edit = new_edit(s)
    with open(args.aab, "rb") as f:
        up = check(s.post(f"{UPLOAD}/edits/{edit}/bundles", params={"uploadType": "media"}, data=f, headers={"Content-Type": "application/octet-stream"}), "upload bundle")
    code = up["versionCode"]
    print(f"uploaded bundle, versionCode {code}")
    set_track(s, edit, "internal", {"name": args.name, "versionCodes": [str(code)], "status": "completed"})
    commit(s, edit)
    print("internal track updated")
    if args.internal_only:
        return

    edit = new_edit(s)
    set_track(s, edit, "production", {"name": args.name, "versionCodes": [str(code)], "status": "inProgress", "userFraction": args.production_fraction})
    commit(s, edit)
    print(f"production rollout started at {args.production_fraction:.0%}")


if __name__ == "__main__":
    main()
