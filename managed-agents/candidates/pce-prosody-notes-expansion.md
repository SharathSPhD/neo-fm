# Candidate: pce-poem prosody notes for the language expansion

Status: CANDIDATE. Not in `apps/web/lib/agent/skill-pce-poem.ts` and not live. These lines are meant to be added to the "Language prosody notes" section of the pce-poem skill, and they reach prod only through the eval gate (n=6 per set, judge plus native-reviewer sample), per the project rule that prod prompt changes go through the gate. Written from general knowledge of each tradition, not checked by a native speaker; every line below is a hypothesis for the eval to test. Plan: strategy/language-expansion.md.

Wave 1

- **Marathi**: write in modern spoken-literary Marathi, not Hindi with Marathi spellings; keep distinctly Marathi words and verb endings (-ला, -ची/-चा, आहे). Use antyaprasa (end rhyme) on paired lines. Abhang and bhakti: short repeating refrain, Vitthal/Pandurang imagery, no Sanskritised padding. Lavani: brisk, playful, call-and-response. Bhavgeet: soft, evening, a single image per line.
- **Punjabi (Gurmukhi)**: write in Gurmukhi with Punjabi forms (ਹੈ -> ਏ/ਐ in song, ਤੇ, ਨੂੰ, ਵੇ/ਨੀ address words). End rhyme on paired lines; folk (boliyan) uses short couplets and a punchy tag line. Pop-Punjabi may mix English words only if the brief asks. Do not write Gurbani or shabad style, and avoid religious imagery unless the brief asks and review is arranged.
- **Malayalam**: keep to natural spoken-literary Malayalam, avoid heavy Sanskrit compounds unless the genre is devotional; end rhyme or second-letter rhyme (dvitiyakshara prasa) on paired lines; film melody lines are long and flowing, mappila pattu uses Arabi-Malayalam vocabulary, Onam songs are festive with short repeated refrain. Write chillu letters (ൺ ൻ ർ ൽ ൾ) in their atomic form.
- **Gujarati**: spoken-literary Gujarati; garba lines are short, rhythmic, with a refrain returned to every second line and call to clap (તાળી); prabhatiya is gentle devotional; sugam sangeet is a single mood with end rhyme. Keep the Gujarati forms (છે, ને, માં) and avoid Hindi forms.

Wave 2

- **Odia**: standard Odia (ଓଡ଼ିଆ) with Odia verb forms; devotional (Jagannath bhajan) and light classical use end rhyme and a recurring name refrain; folk (Sambalpuri) is brisk and call-and-response.
- **Urdu (Nastaliq)**: one register throughout, literary Urdu with Persian-Arabic vocabulary; ghazal: a refrain (radif) repeated at the end of every second line, preceded by a rhyme word (qafia), all couplets in the same metre; nazm: free of radif, a progressing thought; qawwali: repeated hook and call-and-response. Write right-to-left in Arabic script; no Devanagari or Roman.
- **Bhojpuri (Devanagari)**: Bhojpuri forms, not Hindi (रउरा, हमार, बा, जा, भइल); folk forms sohar, birha, kajari, chhath geet. Family-safe by default: no sexual or crude content, no innuendo. If a brief asks for it, refuse the line and write a clean alternative.

Wave 3

- **Assamese**: Assamese forms and letters (ৰ, ৱ), not Bengali spellings; Bihu songs: brisk, spring imagery, call-and-response; Borgeet: devotional, slow, drone.

All: pair lines with equal syllable count (they must sing to one tune); never exceed about 9 short lines for a 30 s song; no stock film-lyric pairings unless the brief asks; native script only.

## Eval plan (to run when a spend line exists)

Per language, 6 PCE briefs through the current skill and through the skill plus its notes, same seeds; blind Gemini judge on lyric quality and the order-free diction score on one render each (Lyria cost). Promote the notes for a language only if they do not lower the judge mean or the diction score. Claude spend about USD 0.1 per generation; needs the eval-bucket approval.
