# Corpus growth: public-domain lyrics and licence-tiered music catalogue (2026-10-21)

Tools: `tools/corpus-growth/`. Data (not in git): `/mnt/project-files/corpus/` (`lyrics-pd/*.jsonl` + `manifest.json`, `music/*.jsonl`, `music/probe.json`). Rebuild: `build_all.sh`.
Focus order set by S (2026-10-21): Kannada and Hindi first, then English; Telugu, Marathi, Gujarati came along nearly free; Tamil, Bengali, Malayalam, Punjabi are extracted but not yet gated.

## What was added

| Lang | Verse units | Chars | Tier A (clean) | Tier B (edition review) | Main sources |
|---|---|---|---|---|---|
| hi | 7,595 | 5.6M | 4,694 | 2,901 | Kabir, Tulsidas, Nabhadas, Jayasi, Keshavdas, Bhikharidas, Ratnakar, Hariaudh, Nirala, Subhadra Kumari Chauhan; Prasad, Bharatendu, Navin (B) |
| kn | 4,342 | 3.8M | 163 | 4,179 | 12th-c vachanas and Kanaka Dasa (B: modern editions), Nagachandra, Muddana, Mangarasa |
| te | 5,523 | 3.3M | 5,523 | 0 | Annamayya family, Tyagaraja, Ramadasu, Vemana, Potana |
| en | 1,816 | 1.4M | 1,816 | 0 | Gutenberg songbooks (Scottish Minstrel, Golden Treasury, cowboy songs, negro folk rhymes), en.wikisource songs, ballads, shanties |
| mr | 159 | 0.2M | 159 | 0 | Tukaram, Warkari sants, Keshavsut, Balakavi |
| gu | 145 | 0.1M | 145 | 0 | Mirabai, Narsinh Mehta, Premanand |

A unit is one proofread Wikisource page or one poem (3 to 60 short lines), with author, work, page title and revision id. Gate rule: author on `pd_authors.json` with death year <= 1964 (India: life + 60) or a pre-modern author. Tier B means the poetry is public domain but the Wikisource scan is a modern edition (commentary, editor notes) that may carry its own right: use as harness references only until reviewed. Rows are noisy (page-level cuts, some commentary lines survive the heuristics); score before training.

Music catalogue (metadata only, no audio fetched): 2,813 Internet Archive items by tier (A public-domain mark/CC0 714, B CC-BY/BY-SA 221, C NC/ND eval-only 1,458, P India 78rpm <= 1965 420), 235 Wikimedia Commons instrument clips with licence (CC0/CC-BY/PD only), the Saraga record (CC BY-NC-SA, eval only).

## Where licensing limits what is possible

- Film, album and modern song lyrics and audio are in copyright (lyricist life + 60, recording 60 years from publication). None are scraped or listed as training data. Pre-1965 Indian sound recordings are past their recording term but the composition and lyric rights are separate: tier P is catalogue-only until cleared.
- Saraga, Dunya, MTG-Jamendo, SongEval are non-commercial: evaluation only, never in anything shipped.
- Unlock for modern taste: (a) a publisher or society licence (Saregama, IPRS/lyricist partnerships) or direct artist/lyricist agreements; (b) listener behaviour on our own AI-labelled tracks (finishes, skips, replays), which is ours and free; (c) feature-only data (tags, tempo, raga, structure) without lyric text.
- Tier B and Wikisource's CC BY-SA wrapper need a lawyer's view before any model weights are trained on them. Retrieval as harness references is the lower-risk use.

## Does naming an instrument change the audio? (free probe, 101 existing Lyria renders)

`tools/corpus-growth/instrument_probe.py`: CLAP zero-shot (CPU) on renders from lab m1, m1b, m3, comparing files whose prompt named an instrument with the rest. AUC 0.5 = no effect.
Detectable when named: santoor 1.0 (n=2), piano .99, flute .94 (n=16), strings .93, brass .91, tanpura .88, sitar .80 (n=11), veena .75 (n=4), nadaswaram .73, harmonium .72.
Not detectable: dhol .53, dholak .51, shehnai .43, tabla .33 (n=23).
Caveats: prompts that name tabla or dhol also name genres and other instruments, CLAP is weak on Indian instruments, and several n are 2 to 4. Read this as "melodic instruments probably follow the prompt, percussion naming is unproven", not as proof. The decisive test is a paired A/B (same prompt with and without the instrument, Gemini listens): about 24 Flash renders, estimated GBP 6 plus listens, needs S's tap card.

## Next

1. Score a sample of the gated units with the existing judges (paid, needs S's tap) and keep the best as per-language exemplars for the lyrics harness (Hindi and Kannada first).
2. Paired instrument A/B above, then add a tested instrument line to the Lyria style text for carnatic and hindustani presets.
3. Gate Tamil and Bengali (Tamil Wikisource is mostly post-1965 authors; needs a stricter list).
4. Western English: add MusicBrainz/AcousticBrainz tag data (feature-only) and curated pre-1929 US popular songs from Library of Congress sheet music.

## Song-form ref candidates (10-21)
- `pad_refs.py`: hi pad/doha/kirtan pages from proofread Wikisource (Ratnakar 303, Kabir Granthavali 175+44, Bhramar-geet-sar 33, Vinay Patrika 20 ...), 588 pages with lyricmetrics det >= 60. Output `corpus/refs/hi.jsonl` (tier B).
- kn: Wikisource proofread pages are scholarly prose; song-form comes from the gated main-namespace set. `corpus/refs/kn.jsonl` = 1315 units det >= 50, of which Kanaka Dasa kirtanas 264, mostly unrhymed vachanas otherwise. Purandara Dasa is only 4 pages on Wikisource: more kn kirtana volume needs a licensed source.
- `wikisource_songs.py`: title-prefix extractor (finds almost nothing; the collections transclude Page-namespace text).
- `wikidata_songs.py`: CC0 song facts; Indian-language coverage is thin (kn 3, hi 1, ta 10, te 11, ml 51, gu 565, en 8172). MusicBrainz/Saraga remain the metadata route for Indian film and raga facts.
- Hindi ghazal: `refs/hi.jsonl` gains 55 Diwan-e-Ghalib pages (det 50-75, form=ghazal). Hindi Wikisource has no Mir, Zafar or Zauq; those need Urdu Wikisource (Urdu script) or a licensed Devanagari edition.
- Licence-ask email drafts (Saregama, IPRS, Dasa Sahitya custodians) are at /mnt/project-files/corpus/outreach/licence-ask-drafts.md, drafts only, never sent.
- Kannada kirtana/folk OCR (`ia_kn_texts.py`): DLI scans on Internet Archive (Osmania 1925-30 Purandara, Jagannatha, Vadiraja kirtane; Purandara padagalu; Aratiya haadu 1931; janapada collections). Units kept at det >= 60, no Latin characters, deduped, flagged `ocr: true`; appended to `refs/kn.jsonl` as tier B (scan/collector rights unverified; the janapada collections are modern compilations, so treat as eval-only until checked).
- Kannada OCR filter (`kn_ocr_filter.py`): char 4-gram cross-entropy vs 4.3k clean Wikisource units (threshold = held-out p95, 3.78 bits/char) plus orthography rules (virama not followed by a consonant, doubled matras, signs without a base, digits glued to letters, foreign characters). 1,309 OCR units -> 114 tier A (clean, PD dasa kirtana books, kirtana markers present: ಪಲ್ಲವಿ/ಅನುಪಲ್ಲ/॥), the rest stay tier B. Outputs: `refs/kn_tierA.jsonl`, `refs/kn_ocr_scored.jsonl`. Tier A units still carry occasional residual OCR errors and raga/tala header lines; the filter bounds noise, it does not remove it.
