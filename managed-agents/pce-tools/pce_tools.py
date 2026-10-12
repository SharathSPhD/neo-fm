#!/usr/bin/env python3
"""Offline `audit` and `interpret` commands for a cascade `result.json` (ports of the plugin's audit/interpret ideas).

Usage:  python3 pce_tools.py audit <result.json>       machine-checkable receipt checks (exit 1 if any fail)
        python3 pce_tools.py interpret <result.json>   plain-language account of why the cascade committed what it did

Read-only and stdlib-only: no LM calls, no embedder, no prod config. It never feeds back into prompts; it only
explains a finished run, so it cannot change generation behaviour.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def _audit_of(result: dict) -> dict:
    # run_cascade.py nests the cascade's own audit under result["audit"]["audit"]
    a = result.get("audit") or {}
    return a.get("audit", a)


def audit(result: dict) -> list[tuple[str, bool, str]]:
    """Return (check, passed, detail) rows. A run is only a valid PCE receipt if every row passes."""
    a = _audit_of(result)
    rows: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str) -> None:
        rows.append((name, bool(ok), detail))

    check("two-pass receipt", a.get("two_pass") is True and not a.get("bypassed"), f"two_pass={a.get('two_pass')} bypassed={a.get('bypassed')}")
    check("committed is draft|revision", result.get("committed") in ("draft", "revision"), f"committed={result.get('committed')}")
    check("surface non-empty", bool(str(result.get("surface", "")).strip()), f"{len(str(result.get('surface', '')))} chars")
    post = result.get("posterior") or []
    check("posterior sums to 1", bool(post) and abs(sum(post) - 1) < 1e-4, f"sum={sum(post):.6f} n={len(post)}")
    committed = result.get("committed")
    sel = a.get("selected_idx")
    n = len(a.get("ananda_scores_revision" if committed == "revision" else "ananda_scores_draft", []))
    check("selected index in range", isinstance(sel, int) and 0 <= sel < max(n, 1), f"selected_idx={sel} of {n}")
    ledger = a.get("budget_ledger") or {}
    check("free-energy budget not underwater", not a.get("fe_budget_underwater", False), f"underwater={a.get('fe_budget_underwater')} ledger_keys={sorted(ledger)[:4]}")
    check("embedder is multilingual service", str(result.get("embedder", "")).endswith("@service"),
          f"embedder={result.get('embedder')} (lexical fallback is near-zero for Indic text)")
    return rows


def interpret(result: dict) -> str:
    """Explain the commit decision in words from the audit fields only."""
    a = _audit_of(result)
    committed = result.get("committed")
    dF = a.get("delta_F_draft", 0.0)
    thr = a.get("delta_F_threshold", 0.05)
    lines = [f"Committed the {committed}. Policy: {a.get('commit_policy', 'event_gated')}."]
    if result.get("vimarsa_event"):
        lines.append(f"Vimarsa fired (novelty {result.get('vimarsa_novelty')}, delta-F {dF:.3f} >= {thr}), so the revision was eligible.")
    else:
        lines.append(f"Vimarsa did not fire (delta-F {dF:.3f}, threshold {thr}); under event-gated commit the draft stands.")
    if a.get("revision_differs_from_draft") is False:
        lines.append("The revision was identical to the draft, so the choice made no difference to the text.")
    for key, label in (("ananda_scores_draft", "draft"), ("ananda_scores_revision", "revision")):
        s = a.get(key) or []
        if s:
            top = max(range(len(s)), key=s.__getitem__)
            lines.append(f"Best {label} candidate by ananda: #{top} ({s[top]:.3f}) of {len(s)}.")
    if not str(result.get("embedder", "")).endswith("@service"):
        lines.append("Caveat: the lexical fallback embedder was used, so apohana/aspect cosines are unreliable for Indic text.")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    if len(argv) != 3 or argv[1] not in ("audit", "interpret"):
        print(__doc__)
        return 2
    result = json.loads(Path(argv[2]).read_text(encoding="utf-8"))
    if argv[1] == "interpret":
        print(interpret(result))
        return 0
    rows = audit(result)
    for name, ok, detail in rows:
        print(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}")
    return 0 if all(ok for _, ok, _ in rows) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
