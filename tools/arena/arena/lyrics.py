"""Blind pairwise lyric judging.

Every pair is judged in both orders (A/B swapped) so a position-biased judge cancels out, and the
two verdicts are merged into one battle with the same rule the lab used (summed six-dimension
difference >= 1 is a win, else a tie). `make-jobs` writes a file in the format of
POST /api/admin/lyrics-teacher; `ingest` reads that route's results back. `run` is a direct
Anthropic API runner with a hard USD stop for when the route is not usable.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.request

from . import store

DIMS = ["meter_singability", "rhyme_prasa", "imagery", "diction_register", "cultural_fit", "brief_fidelity"]
MODEL = "claude-sonnet-5-5"
JUDGE_ID = f"{MODEL}/lyrics-v1"
# list prices USD per million tokens; override with ARENA_PRICE_IN / ARENA_PRICE_OUT. The lab's
# route meter undercounts, so estimates here are the number to trust.
PRICE_IN = float(os.environ.get("ARENA_PRICE_IN", 3.0))
PRICE_OUT = float(os.environ.get("ARENA_PRICE_OUT", 15.0))
OUT_TOKENS = 450
SYSTEM = (
    "You are a senior lyricist and native-level editor in the given Indian language. Two song lyrics were "
    "written for the same brief. Read the brief, then lyric A and lyric B. Score each lyric 1-5 (integers; "
    "3 = competent, 5 = outstanding) on these six dimensions:\n"
    "- meter_singability: paired lines have matching syllable counts and a steady beat; words fall naturally on a tune\n"
    "- rhyme_prasa: the rhyme/prasa/edugai/antyaprasa the style expects, natural, not forced\n"
    "- imagery: fresh, concrete images, no stock film-lyric clichés\n"
    "- diction_register: native, idiomatic, one register, correct spelling in native script; invented or ungrammatical words lose points\n"
    "- cultural_fit: faithful to the culture, season, ritual and emotion in the brief\n"
    "- brief_fidelity: the names, occasion and asks of the brief are present and meaningful\n"
    "Judge quality, not length. Pick the overall `winner`: \"A\", \"B\" or \"tie\". Think as a senior lyricist and "
    "native-level editor of that language.\nDo not write any prose before the JSON. Reply with ONLY JSON: "
    "{\"reason\":\"<=40 words\",\"A\":{six scores},\"B\":{six scores},\"winner\":\"A|B|tie\"}"
)


def job_id(a: str, b: str, brief: str, order: str) -> str:
    return f"lyr|{a}|{b}|{brief}|{order}"


def prompt(brief: dict, first: str, second: str) -> str:
    return (f"Language: {brief['language']}\nStyle: {brief['style']}\nBrief: {brief['brief']}\n\n"
            f"=== LYRIC A ===\n{first}\n\n=== LYRIC B ===\n{second}")


def already_judged() -> set[tuple[str, str, str]]:
    return {(r["a"], r["b"], r["brief"]) for r in store.read_jsonl("battles.jsonl") if r["kind"] == "lyrics"} | \
           {(r["b"], r["a"], r["brief"]) for r in store.read_jsonl("battles.jsonl") if r["kind"] == "lyrics"}


def pairs_for(a: str, b: str, limit_per_lang: int | None = None, redo: bool = False) -> list[tuple[dict, str, str]]:
    brs = store.briefs("lyrics")
    A, B = store.entries("lyrics", a), store.entries("lyrics", b)
    done = set() if redo else already_judged()
    out, per = [], {}
    for bid in sorted(brs):
        if bid not in A or bid not in B or (a, b, bid) in done:
            continue
        lang = brs[bid]["lang"]
        if limit_per_lang is not None and per.get(lang, 0) >= limit_per_lang:
            continue
        per[lang] = per.get(lang, 0) + 1
        out.append((brs[bid], A[bid], B[bid]))
    return out


def estimate_usd(prompts: list[str]) -> float:
    # ~2.5 chars/token is pessimistic for Indic scripts; this is a ceiling, not a mean
    tin = sum(len(SYSTEM) + len(p) for p in prompts) / 2.5
    return (tin * PRICE_IN + OUT_TOKENS * len(prompts) * PRICE_OUT) / 1e6


def make_jobs(a: str, b: str, limit_per_lang=None, redo=False, max_usd: float = 1.5) -> dict:
    """Route request body: two jobs per (brief) so both orders are judged."""
    jobs = []
    for br, la, lb in pairs_for(a, b, limit_per_lang, redo):
        jobs.append({"id": job_id(a, b, br["id"], "ab"), "n": 1, "prompt": prompt(br, la, lb)})
        jobs.append({"id": job_id(a, b, br["id"], "ba"), "n": 1, "prompt": prompt(br, lb, la)})
    est = estimate_usd([j["prompt"] for j in jobs])
    return {"model": MODEL, "system": SYSTEM, "max_tokens": 800, "max_usd": max_usd, "jobs": jobs,
            "_estimate_usd": round(est, 3)}


def parse_verdict(text: str) -> dict | None:
    """Last balanced JSON object that carries a winner; the route sometimes emits prose first."""
    for m in reversed([m.start() for m in re.finditer(r"\{", text)]):
        for e in range(len(text), m, -1):
            if text[e - 1] != "}":
                continue
            try:
                j = json.loads(text[m:e])
            except ValueError:
                continue
            if isinstance(j, dict) and j.get("winner") in ("A", "B", "tie") and all(
                    isinstance(j.get(k), dict) and all(isinstance(j[k].get(d), (int, float)) and 1 <= j[k][d] <= 5
                                                       for d in DIMS) for k in "AB"):
                return j
    return None


def merge(j_ab: dict, j_ba: dict) -> dict:
    """x = first-slot lyric in the 'ab' call. Returns outcome for x plus position-bias votes."""
    diff = {d: ((j_ab["A"][d] - j_ab["B"][d]) + (j_ba["B"][d] - j_ba["A"][d])) / 2 for d in DIMS}
    tot = sum(diff.values())
    score = 1.0 if tot >= 1 else 0.0 if tot <= -1 else 0.5
    return {"score": score, "tot": round(tot, 2), "diff": {k: round(v, 2) for k, v in diff.items()},
            "pos_a": [j_ab["winner"] == "A", j_ba["winner"] == "A"]}


def ingest(results: dict, a: str, b: str, ts: str) -> dict:
    """`results` is the route's {"results": {id: [text]}} body (or its inner dict)."""
    results = results.get("results", results)
    rows, bad = [], []
    briefs_seen = sorted({k.split("|")[3] for k in results if k.startswith(f"lyr|{a}|{b}|")})
    for bid in briefs_seen:
        got = []
        for order in ("ab", "ba"):
            t = (results.get(job_id(a, b, bid, order)) or [""])[0]
            got.append(parse_verdict(t) if t else None)
        if not all(got):
            bad.append(bid)
            continue
        m = merge(*got)
        rows.append({"kind": "lyrics", "a": a, "b": b, "brief": bid, "score": m["score"], "tot": m["tot"],
                     "diff": m["diff"], "pos_a": m["pos_a"], "judge": JUDGE_ID, "ts": ts})
    store.append_jsonl("battles.jsonl", rows)
    return {"added": len(rows), "unparsed": bad}


def run(a: str, b: str, hard_stop_usd: float, ts: str, limit_per_lang=None) -> dict:
    """Direct Anthropic API judge with a hard stop; spend is counted from reported usage, not estimated."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise SystemExit("ANTHROPIC_API_KEY not set")
    body = make_jobs(a, b, limit_per_lang)
    if body["_estimate_usd"] > hard_stop_usd:
        raise SystemExit(f"estimate {body['_estimate_usd']} exceeds hard stop {hard_stop_usd}; narrow with --limit-per-lang")
    spent, results = 0.0, {}
    for j in body["jobs"]:
        if spent >= hard_stop_usd:
            break
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            json.dumps({"model": MODEL, "max_tokens": 800, "system": SYSTEM,
                        "messages": [{"role": "user", "content": j["prompt"]}]}).encode(),
            {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            d = json.load(r)
        u = d.get("usage", {})
        spent += (u.get("input_tokens", 0) * PRICE_IN + u.get("output_tokens", 0) * PRICE_OUT) / 1e6
        results[j["id"]] = ["".join(c.get("text", "") for c in d.get("content", []))]
    out = ingest({"results": results}, a, b, ts)
    out["spent_usd"] = round(spent, 4)
    return out


def digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:12]
