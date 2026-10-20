# Cloud-session job: blind pairwise lyric judging

You run on S's claude.ai cloud-session credits. Budget cap: USD 4. Stop at the cap, commit what you have and say so. No keys, web or other repo parts are needed.

`tools/lyrics-lab/cloud/judge/in/judge_{0..7}.json` are 8 files of 30 items. Each item has `item`, `language`, `style`, `brief`, and two lyrics `A` and `B` for the same brief. You do not know how either was made; do not look for any key.
Run the 8 files as parallel sub-agents (one per file), each reading only its own file, and write `tools/lyrics-lab/cloud/judge/out/judge_{k}.json` as `{ "<item>": {"reason": "<=40 words", "A": {dims}, "B": {dims}, "winner": "A|B|tie"} }`.

Score each lyric 1-5 (integers; 3 competent, 5 outstanding) on:
- meter_singability: paired lines have matching syllable counts and a steady beat; the words fall naturally on a tune; no tongue-twisting clusters
- rhyme_prasa: the rhyme / prasa / edugai / antyaprasa the style expects, used naturally without forcing
- imagery: fresh, specific, concrete images; no stock film-lyric clichés
- diction_register: native, idiomatic, one consistent register, correct spelling in native script, not translated-sounding, no stray English
- cultural_fit: faithful to the culture, season, ritual and emotion the brief names
- brief_fidelity: names, occasion and concrete asks of the brief are present and meaningful
Judge as a senior lyricist and native-level editor of that language. Judge quality, not length. Invented or ungrammatical words lose points on diction_register. Then choose the overall `winner`: "A", "B" or "tie".

Check: every item of every file has an entry with all six scores for A and B; fix and rerun otherwise. Commit `tools/lyrics-lab/cloud/judge/out/` (force-add if ignored), push to the branch you are on, and send me one line with the branch name.
