# Cloud-session job: Claude teacher lyrics (LyricBench-5 training briefs)

You are a cloud session running on S's claude.ai cloud-session credits. Budget cap: USD 5 of credits. If you reach it, stop, commit what you have and say so.
No API keys, no web, no external services are needed. Do not touch any other part of the repo.

## Task
`tools/lyrics-lab/cloud/briefs/briefs_{kn,hi,te,ta,mr}_{0,1}.json` are 10 files of 30 briefs each. Every brief has an `id`, `lang`, `language`, `style`, `brief` and an exact `prompt`.
For each brief write **4 distinct candidate lyrics** that follow its `prompt` exactly, and write `tools/lyrics-lab/cloud/out/out_{lang}_{k}.json` as `{ "<id>": ["cand1","cand2","cand3","cand4"], ... }` (UTF-8, `ensure_ascii=False`).

Run the 10 files as parallel sub-agents (one per file) if you can; each only reads its own briefs file.

## Quality rules (what the lab found matters)
- Native script only, no transliteration, no translation, no commentary. Output is the lyrics with section tags such as [Hook]/[Verse], nothing else.
- About 8 short lines, 40-70 words, 2-line hook plus two 2-line verses. Hook may return once; otherwise no repeated lines (repetition inflates the score and is penalised).
- Real rhyme and balanced metre for the language (Kannada/Telugu/Tamil prasa, Hindi/Marathi antya-prasa), in natural spoken diction, not bookish. Concrete imagery from the brief, not generic romance filler.
- The 4 candidates must differ in imagery, rhyme scheme and opening, not be paraphrases.
- Original writing only. Never reproduce or imitate real song lyrics, poems or an artist's style; no artist names.

## Check and deliver
1. `python3 tools/lyrics-lab/cloud/validate.py tools/lyrics-lab/cloud/out` must end with `problems 0`. Fix any short or invalid entry and rerun.
2. Commit `tools/lyrics-lab/cloud/out/` on the branch you are on and push it. Say the branch name in your final message.
