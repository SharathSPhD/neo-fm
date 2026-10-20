"""python3 -m arena <command>. See tools/arena/README.md."""
from __future__ import annotations

import argparse
import datetime
import json
import sys

from . import cost, leaderboard, lyrics, seed, songs, store


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="arena")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("seed-lab", help="import the lab's paid judgments (no spend)"); s.add_argument("src")
    s = sub.add_parser("register", help="add or update a variant")
    s.add_argument("variant"); s.add_argument("--kind", choices=["lyrics", "songs"], required=True)
    s.add_argument("--label"); s.add_argument("--owner", default=""); s.add_argument("--reference", action="store_true")
    s = sub.add_parser("jobs", help="write judge jobs (route format) and print the estimate")
    s.add_argument("a"); s.add_argument("b"); s.add_argument("--out", required=True)
    s.add_argument("--limit-per-lang", type=int); s.add_argument("--redo", action="store_true")
    s = sub.add_parser("ingest", help="read route results for a pair"); s.add_argument("a"); s.add_argument("b"); s.add_argument("results")
    s = sub.add_parser("run", help="direct Claude API judge with a hard USD stop")
    s.add_argument("a"); s.add_argument("b"); s.add_argument("--hard-stop-usd", type=float, required=True)
    s.add_argument("--limit-per-lang", type=int)
    s = sub.add_parser("songs", help="turn scorer outputs of two song variants into battles")
    s.add_argument("a"); s.add_argument("b"); s.add_argument("--margin", type=float, default=songs.MARGIN)
    s = sub.add_parser("cost", help="record generation cost"); s.add_argument("variant"); s.add_argument("brief"); s.add_argument("usd", type=float); s.add_argument("--note", default="")
    s = sub.add_parser("report", help="print leaderboard markdown"); s.add_argument("--kind", default="lyrics"); s.add_argument("--judge-prefix")
    s = sub.add_parser("page", help="write leaderboard.html"); s.add_argument("--out", default="out/leaderboard.html")
    s.add_argument("--lyrics-judge-prefix"); s.add_argument("--songs-judge-prefix")
    a = p.parse_args(argv)
    if a.cmd == "seed-lab":
        print(seed.import_lab(a.src, now()))
    elif a.cmd == "register":
        v = store.variants(); v[a.variant] = {"kind": a.kind, "label": a.label or a.variant, "owner": a.owner, **({"reference": True} if a.reference else {})}
        store.write_json("variants.json", v)
    elif a.cmd == "jobs":
        body = lyrics.make_jobs(a.a, a.b, a.limit_per_lang, a.redo)
        json.dump(body, open(a.out, "w", encoding="utf-8"), ensure_ascii=False)
        print(f"{len(body['jobs'])} calls, estimated ceiling USD {body['_estimate_usd']} (list price; the route meter undercounts)")
    elif a.cmd == "ingest":
        print(lyrics.ingest(json.load(open(a.results, encoding="utf-8")), a.a, a.b, now()))
    elif a.cmd == "run":
        print(lyrics.run(a.a, a.b, a.hard_stop_usd, now(), a.limit_per_lang))
    elif a.cmd == "songs":
        rows = songs.battles(a.a, a.b, now(), a.margin); store.append_jsonl("battles.jsonl", rows); print({"added": len(rows)})
    elif a.cmd == "cost":
        store.append_jsonl("costs.jsonl", [{"variant": a.variant, "brief": a.brief, "usd": a.usd, "note": a.note, "ts": now()}])
    elif a.cmd == "report":
        print(leaderboard.markdown(a.kind, judge_prefix=a.judge_prefix))
    elif a.cmd == "page":
        import os
        os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
        open(a.out, "w", encoding="utf-8").write(leaderboard.page(now(), {"lyrics": a.lyrics_judge_prefix, "songs": a.songs_judge_prefix}))
        print("wrote", a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
