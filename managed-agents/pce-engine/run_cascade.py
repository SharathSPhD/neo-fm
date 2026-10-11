#!/usr/bin/env python3
"""Driver: runs the Pratyabhijna cascade (vendored `pce` package) with the agent as the language model.

Usage:  python3 run_cascade.py <workdir>
Reads   <workdir>/brief.json        {"topic","constraint","must_avoid":[],"aspects":[],"K":3,"retrieval_set":[]}
        <workdir>/generations.json  {"draft":[texts...],"revision":[texts...]}   (optional, grows over rounds)
Writes  <workdir>/needs.json        when the cascade needs more candidate texts (exit code 3)
        <workdir>/result.json       the committed surface + full audit (exit code 0)
Round 1 asks for K draft candidates; round 2 (after the draft pass) asks for K revision candidates built
from the cascade's own reviser brief. Nothing is mocked: operators, scoring, vimarsa and the commit
policy are the original code.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402

from pce.cascade import run_cascade  # noqa: E402
from pce.substrate.embed import Embedder as LexicalEmbedder  # noqa: E402
from pce.operators.iccha import PERTURBATION_TABLE, iccha  # noqa: E402
from pce.substrate.replay_lm import NeedGeneration, RecorderLM, ReplayLM  # noqa: E402
from pce.types import Constraint  # noqa: E402


def _load(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def main(workdir: str) -> int:
    wd = Path(workdir)
    brief = json.loads((wd / "brief.json").read_text(encoding="utf-8"))
    gens = _load(wd / "generations.json", {"draft": [], "revision": []})
    if os.environ.get("EMBED_URL") and os.environ.get("EMBED_TOKEN"):
        from pce.substrate.http_embed import Embedder  # multilingual service (preferred)

        embed = Embedder()
    else:
        embed = LexicalEmbedder()  # offline fallback: lexical only, flagged in result.json
    constraint = Constraint(
        text=brief["constraint"],
        embedding=embed.encode(brief["constraint"]),
        must_avoid=tuple(brief.get("must_avoid", [])),
    )
    lm = ReplayLM(gens.get("draft", []), gens.get("revision", []), embed)
    K = int(brief.get("K", 3))
    cit_t = float(brief.get("cit_temperature", 1 / 3))  # 1/3 is the neutral point: exactly K candidates per pass
    try:
        state = run_cascade(
            brief["topic"], constraint, lm=lm, embed=embed, K=K,
            aspects=brief.get("aspects") or None,
            retrieval_set=brief.get("retrieval_set") or None,
            cit_temperature=cit_t,
            aspect_cosine_hit=float(brief.get("aspect_cosine_hit", 0.20 if embed.model_id.endswith("@service") else 0.40)),
            commit_policy=brief.get("commit_policy", "event_gated"),
            base_seed=int(brief.get("seed", 0)),
        )
    except NeedGeneration as need:
        # Enumerate every request of this pass (each candidate has its own prompt perturbation).
        base_prompt = need.prompt
        for pert in PERTURBATION_TABLE:
            if pert and base_prompt.startswith(pert):
                base_prompt = base_prompt[len(pert):]
                break
        rec = RecorderLM()
        iccha(base_prompt, constraint, lm=rec, K=K, base_seed=need.seed - need.have, cit_temperature=cit_t)
        prompts = [p for p, _ in rec.requests]
        (wd / "needs.json").write_text(json.dumps({
            "kind": need.kind, "have": need.have, "need": len(prompts), "prompts": prompts,
            "instruction": f"Write {len(prompts)} complete candidates, one per entry of `prompts` (in order; candidate i answers prompts[i], "
                           f"honouring its leading nudge), as generations.json['{need.kind}'] = [text, ...]. Same language and form as the brief.",
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"NEEDS {need.kind} have={need.have} need={len(prompts)} -> {wd/'needs.json'}")
        return 3
    audit = state.to_audit()
    result = {
        "surface": state.surface, "committed": state.committed, "vimarsa_event": state.vimarsa_event,
        "vimarsa_novelty": state.vimarsa_novelty, "posterior": [float(p) for p in np.asarray(state.posterior)],
        "surface_draft": state.surface_draft, "surface_revision": state.surface_revision,
        "embedder": embed.model_id, "audit": audit,
    }
    (wd / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"DONE committed={state.committed} vimarsa_event={state.vimarsa_event}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))
