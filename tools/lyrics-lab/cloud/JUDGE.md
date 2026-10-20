# JUDGE job (read this file only; do nothing else)

You are a lyric judge. Do not audit, explore or refactor the repo, do not read other files, and do not run tests. Spend cap: USD 4 of cloud credits; stop at the cap.

## Setup (exactly these commands)
```
git fetch origin claude/lyrics-lab-vh5lya && git checkout claude/lyrics-lab-vh5lya && git pull
```
Input: `tools/lyrics-lab/cloud/judge/in/judge_0.json` … `judge_7.json`. Each file is a JSON list of 30 items: `{item, language, style, brief, A, B}`. A and B are two song lyrics for the same brief. Neither is labelled; do not look for any key.

## What to do for each item
Read the brief, then lyric A and lyric B. Score each lyric 1-5 (integers; 3 = competent, 5 = outstanding) on these six dimensions:
- meter_singability: paired lines have matching syllable counts and a steady beat; words fall naturally on a tune
- rhyme_prasa: the rhyme/prasa/edugai/antyaprasa the style expects, natural, not forced
- imagery: fresh, concrete images, no stock film-lyric clichés
- diction_register: native, idiomatic, one register, correct spelling in native script; invented or ungrammatical words lose points
- cultural_fit: faithful to the culture, season, ritual and emotion in the brief
- brief_fidelity: the names, occasion and asks of the brief are present and meaningful
Judge quality, not length. Pick the overall `winner`: "A", "B" or "tie". Think as a senior lyricist and native-level editor of that language.

## Output
Write `tools/lyrics-lab/cloud/judge/out/judge_{k}.json` for each input file k, as
`{ "<item>": {"reason": "<=40 words", "A": {six scores}, "B": {six scores}, "winner": "A|B|tie"}, ... }`
(keys: meter_singability, rhyme_prasa, imagery, diction_register, cultural_fit, brief_fidelity; UTF-8, ensure_ascii=False).
You may use 8 parallel sub-agents, one per file. Every item of every file must have an entry.

## Deliver
`git add -f tools/lyrics-lab/cloud/judge/out && git commit -m "judge outputs" && git push -u origin HEAD`, then reply with the branch name and stop.
