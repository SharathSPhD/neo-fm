"""Markdown and self-contained HTML leaderboards."""
from __future__ import annotations

import html
from collections import Counter, defaultdict

from . import cost, ratings, store


def load(kind: str, judge_prefix: str | None = None, lang: str | None = None):
    br = store.briefs(kind)
    bs = []
    for r in store.read_jsonl("battles.jsonl"):
        if r["kind"] != kind or (judge_prefix and not r["judge"].startswith(judge_prefix)):
            continue
        if lang and br.get(r["brief"], {}).get("lang") != lang:
            continue
        bs.append((r["a"], r["b"], r["score"], r["brief"]))
    return bs


def rows_for(kind: str, judge_prefix=None, lang=None, anchor=None, rounds=200) -> list[dict]:
    rows = ratings.table(load(kind, judge_prefix, lang), anchor, rounds)
    c = cost.per_variant()
    meta = store.variants()
    for r in rows:
        r["usd"] = c.get(r["variant"], {}).get("mean_usd")
        r["label"] = meta.get(r["variant"], {}).get("label", r["variant"])
    # plain-English verdict against the reference variant
    ref = next((v for v, m in meta.items() if m["kind"] == kind and m.get("reference")), None)
    for r in rows:
        r["vs_ref"] = "reference" if r["variant"] == ref else (
            {True: "beats", False: "loses to", None: "unresolved vs"}[ratings.beats(rows, r["variant"], ref)] + " reference"
            if ref else "")
    return rows


def position_bias(judge_prefix=None) -> float | None:
    n = a = 0
    for r in store.read_jsonl("battles.jsonl"):
        if r["kind"] == "lyrics" and "pos_a" in r and (not judge_prefix or r["judge"].startswith(judge_prefix)):
            n += 2
            a += sum(bool(x) for x in r["pos_a"])
    return a / n if n else None


def by_language(kind="lyrics", judge_prefix=None, ref_pair=None) -> dict:
    br = store.briefs(kind)
    out: dict[str, dict] = defaultdict(lambda: defaultdict(list))
    for r in store.read_jsonl("battles.jsonl"):
        if r["kind"] != kind or (judge_prefix and not r["judge"].startswith(judge_prefix)):
            continue
        lang = br.get(r["brief"], {}).get("lang", "?")
        out[(r["a"], r["b"])][lang].append(r["score"])
    return {k: {l: round(sum(v) / len(v), 2) for l, v in d.items()} for k, d in out.items()}


def markdown(kind: str, **kw) -> str:
    rows = rows_for(kind, **kw)
    out = [f"| # | variant | Elo (95% CI) | win rate | battles | USD/item | vs reference |", "|---|---|---|---|---|---|---|"]
    for i, r in enumerate(rows, 1):
        usd = "n/a" if r["usd"] is None else f"{r['usd']:.4f}"
        out.append(f"| {i} | {r['label']} | {r['elo']:.0f} ({r['lo']:.0f}-{r['hi']:.0f}) | {r['winrate']:.0%} | "
                   f"{r['battles']} | {usd} | {r['vs_ref']} |")
    return "\n".join(out)


def page(generated: str, judge_prefix: dict[str, str | None] | None = None) -> str:
    judge_prefix = judge_prefix or {}
    sections = []
    for kind, title in (("lyrics", "Lyrics"), ("songs", "Songs")):
        rows = rows_for(kind, judge_prefix=judge_prefix.get(kind))
        if not rows:
            sections.append(f"<section><h2>{title}</h2><p class=muted>No battles yet.</p></section>")
            continue
        top = max(r["hi"] for r in rows) + 20
        low = min(r["lo"] for r in rows) - 20
        body = []
        for i, r in enumerate(rows, 1):
            l, e, h = [(r[k] - low) / (top - low) * 100 for k in ("lo", "elo", "hi")]
            usd = "n/a" if r["usd"] is None else f"${r['usd']:.3f}"
            body.append(
                f"<tr><td>{i}</td><td>{html.escape(r['label'])}<div class=muted>{html.escape(r['variant'])}</div></td>"
                f"<td class=num>{r['elo']:.0f}</td>"
                f"<td class=bar><span class=ci style='left:{l:.1f}%;width:{h - l:.1f}%'></span><span class=pt style='left:{e:.1f}%'></span></td>"
                f"<td class=num>{r['winrate']:.0%}</td><td class=num>{r['battles']}</td><td class=num>{usd}</td>"
                f"<td>{html.escape(r['vs_ref'])}</td></tr>")
        sections.append(f"<section><h2>{title}</h2><table><thead><tr><th>#<th>Variant<th>Elo<th>95% interval<th>Win rate<th>Battles<th>Cost/item<th>vs reference</thead><tbody>{''.join(body)}</tbody></table></section>")
    bias = position_bias()
    note = f"<p class=muted>Judge picks slot A in {bias:.0%} of calls (both orders are judged and merged, so this cancels).</p>" if bias is not None else ""
    return f"""<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>neo-fm arena</title><style>
:root{{--bg:#fff;--fg:#1a1a1a;--mut:#666;--line:#ddd;--acc:#2a5bd7}}
@media(prefers-color-scheme:dark){{:root:not([data-theme=light]){{--bg:#14161a;--fg:#e8e8e8;--mut:#9aa0a6;--line:#2c3036;--acc:#7aa2ff}}}}
body{{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0;padding:16px;max-width:980px;margin-inline:auto}}
h1{{font-size:22px}}h2{{font-size:17px;margin-top:28px}}.muted{{color:var(--mut);font-size:12px}}
.scroll{{overflow-x:auto}}table{{border-collapse:collapse;width:100%}}th,td{{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}}
.num{{text-align:right;font-variant-numeric:tabular-nums}}.bar{{position:relative;min-width:140px;height:28px}}
.ci{{position:absolute;top:13px;height:3px;background:var(--acc);opacity:.45}}.pt{{position:absolute;top:8px;width:4px;height:13px;background:var(--acc);margin-left:-2px}}
</style></head><body><h1>neo-fm arena</h1><p class=muted>Blind pairwise judging, Bradley-Terry ranking (Elo scale, brief-clustered bootstrap). AI judges only; no native-speaker panel. Generated {html.escape(generated)}.</p>
<div class=scroll>{''.join(sections)}</div>{note}</body></html>"""
