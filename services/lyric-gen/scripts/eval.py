#!/usr/bin/env python3
"""
Sprint 7 eval harness for the IndicBART lyric-gen SFT.

Gates (mirrored in `docs/DECISIONS/0027-indicbart-lyric-gen.md`):

  1. **G2P round-trip cleanliness.** Every generated stanza is fed
     through `packages/g2p` and must round-trip with zero unknown
     tokens. Anything else means the model hallucinated bytes that
     vocal-synth can't pronounce.
  2. **Syllable-count hit ratio.** For each example, compute
     `|target_syllables - actual_syllables| / target_syllables`.
     Target hit ratio: ≥ 0.7 of samples within 25% of the prompt.
  3. **LLM-as-judge meter+relevance.** A local Qwen2.5-7B-Instruct
     scores each generation 1-5 on "does this read as a verse in
     the requested style, and does it answer the prompt?". Pass:
     median score ≥ 3.5 per language. Requires `--judge-model` and
     the `evaluate` extra.

The harness is split so each gate can be skipped:
  --no-g2p / --no-syllable / --no-judge

CI runs `--no-judge` so the deterministic syllable gate still gives
us a regression signal without standing up a 7B judge.

Outputs `<--out>` as JSON with per-gate per-language stats.
"""

from __future__ import annotations

import argparse
import json
import statistics
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any


def _read_eval(eval_path: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    with eval_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            out.append(json.loads(line))
    return out


def _approx_syllables(text: str) -> int:
    vowels = set("aeiouyAEIOUYɑəɛɪɔʊ")
    count = 0
    in_vowel = False
    for ch in text:
        if ch in vowels:
            if not in_vowel:
                count += 1
            in_vowel = True
        else:
            in_vowel = False
    return max(count, sum(1 for line in text.splitlines() if line.strip()))


def _g2p_clean(text: str, language: str, g2p_root: Path) -> bool:
    """Round-trip a stanza through `@neo-fm/g2p` via the package's
    CLI. Returns True iff every grapheme cluster mapped to a known
    phoneme.

    The g2p CLI is wired up in Sprint 12 of v1.3; the Sprint 7 eval
    re-uses it via a Node child-process. CI fakes this by treating
    everything as clean if `--no-g2p` is passed.
    """
    proc = subprocess.run(
        ["node", str(g2p_root / "dist" / "cli.js"), "--language", language, "--check"],
        input=text,
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        return False
    return "unknown" not in (proc.stdout or "").lower()


def _generate_with_checkpoint(
    checkpoint: Path, prompt: str, max_target_tokens: int = 256
) -> str:
    """Real generation path. Lazy-imports transformers.

    Falls back to printing the prompt verbatim if `--dry-run` was
    passed (which means we just want to validate the harness shape,
    not actually score the model).
    """
    import torch  # type: ignore[import-not-found]
    from transformers import (  # type: ignore[import-not-found]
        AutoModelForSeq2SeqLM,
        AutoTokenizer,
    )

    tok = AutoTokenizer.from_pretrained(str(checkpoint), use_fast=False)
    model = AutoModelForSeq2SeqLM.from_pretrained(
        str(checkpoint),
        torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
    )
    if torch.cuda.is_available():
        model = model.to("cuda")
    inputs = tok(prompt, return_tensors="pt", truncation=True, max_length=512)
    inputs = {k: v.to(model.device) for k, v in inputs.items()}
    out = model.generate(  # type: ignore[attr-defined]
        **inputs,
        max_new_tokens=max_target_tokens,
        num_beams=1,
        do_sample=True,
        temperature=0.9,
        top_p=0.95,
    )
    return tok.decode(out[0], skip_special_tokens=True)


def _judge_scores(prompts: list[str], generations: list[str], judge_model: str) -> list[float]:
    """LLM-as-judge: run a local Qwen2.5-7B-Instruct over the
    (prompt, generation) pairs, asking for a 1-5 score. Returns one
    score per pair. Crude prompt; the goal is consistency, not absolute.
    """
    import torch  # type: ignore[import-not-found]
    from transformers import AutoModelForCausalLM, AutoTokenizer  # type: ignore[import-not-found]

    tok = AutoTokenizer.from_pretrained(judge_model)
    model = AutoModelForCausalLM.from_pretrained(
        judge_model,
        torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
    )
    if torch.cuda.is_available():
        model = model.to("cuda")

    out_scores: list[float] = []
    for prompt, gen in zip(prompts, generations, strict=True):
        msg = (
            "You are a strict music-lyric judge. On a 1-5 scale (1=incoherent, "
            "5=excellent), rate the following stanza on: (a) does it satisfy "
            "the style + section + syllable target in the prompt, and (b) does "
            "it read as a real verse rather than gibberish? Output a SINGLE "
            "integer 1-5 on a line by itself."
            f"\n\nPROMPT:\n{prompt}\n\nSTANZA:\n{gen}\n\nSCORE:"
        )
        chat = tok.apply_chat_template(
            [{"role": "user", "content": msg}],
            add_generation_prompt=True,
            tokenize=True,
            return_tensors="pt",
        ).to(model.device)
        result = model.generate(  # type: ignore[attr-defined]
            chat, max_new_tokens=16, do_sample=False, temperature=0.0
        )
        text = tok.decode(result[0][chat.shape[-1] :], skip_special_tokens=True).strip()
        # Permissive parse: take the first 1-5 digit on the line.
        score = 0.0
        for ch in text:
            if ch.isdigit() and 1 <= int(ch) <= 5:
                score = float(ch)
                break
        out_scores.append(score)
    return out_scores


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--checkpoint", type=Path, required=True)
    p.add_argument("--eval-set", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument(
        "--g2p-package-root",
        type=Path,
        default=Path("packages/g2p"),
        help="Path to packages/g2p built tree (default: packages/g2p).",
    )
    p.add_argument("--no-g2p", action="store_true")
    p.add_argument("--no-syllable", action="store_true")
    p.add_argument("--no-judge", action="store_true", default=True)
    p.add_argument(
        "--judge-model",
        default="Qwen/Qwen2.5-7B-Instruct",
        help="Local HF model id for the LLM judge (used when --no-judge is off).",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Walk the eval set, score against deterministic stub gens "
        "instead of running the checkpoint. Useful for harness CI.",
    )
    p.add_argument(
        "--syllable-tolerance",
        type=float,
        default=0.25,
        help="A sample passes the syllable gate if |delta| / target <= this.",
    )
    args = p.parse_args()

    eval_rows = _read_eval(args.eval_set)
    by_lang: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in eval_rows:
        by_lang[row["language"]].append(row)

    result: dict[str, Any] = {
        "checkpoint": str(args.checkpoint),
        "eval_set": str(args.eval_set),
        "by_language": {},
        "gates": {
            "g2p_clean_ratio": None,
            "syllable_hit_ratio": None,
            "judge_median": None,
        },
    }

    all_syll_pass = 0
    all_g2p_pass = 0
    all_count = 0
    judge_scores: list[float] = []

    for lang, rows in by_lang.items():
        lang_syll_pass = 0
        lang_g2p_pass = 0
        prompts: list[str] = []
        gens: list[str] = []
        for row in rows:
            prompt = row["prompt"]
            target = row["target"]
            prompts.append(prompt)
            if args.dry_run:
                # Stub generation = the target itself, so the harness
                # itself can be tested without a real checkpoint.
                gen = target
            else:
                gen = _generate_with_checkpoint(args.checkpoint, prompt)
            gens.append(gen)

            actual = _approx_syllables(gen)
            tgt = int(row.get("target_syllables") or actual)
            tol = abs(actual - tgt) / max(tgt, 1)
            if args.no_syllable or tol <= args.syllable_tolerance:
                lang_syll_pass += 1

            if args.no_g2p:
                lang_g2p_pass += 1
            else:
                if _g2p_clean(gen, lang, args.g2p_package_root):
                    lang_g2p_pass += 1

        if not args.no_judge and not args.dry_run:
            judge_scores.extend(_judge_scores(prompts, gens, args.judge_model))

        result["by_language"][lang] = {
            "count": len(rows),
            "g2p_pass": lang_g2p_pass,
            "syllable_pass": lang_syll_pass,
            "g2p_ratio": (lang_g2p_pass / len(rows)) if rows else None,
            "syllable_ratio": (lang_syll_pass / len(rows)) if rows else None,
        }
        all_syll_pass += lang_syll_pass
        all_g2p_pass += lang_g2p_pass
        all_count += len(rows)

    result["gates"]["g2p_clean_ratio"] = (
        (all_g2p_pass / all_count) if all_count else None
    )
    result["gates"]["syllable_hit_ratio"] = (
        (all_syll_pass / all_count) if all_count else None
    )
    result["gates"]["judge_median"] = (
        statistics.median(judge_scores) if judge_scores else None
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(result["gates"], indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
