# Voice diversity and nativeness (2026-10-18)

Machine judgments only (Gemini listens, `scripts/quality/voice-judge.mts`), not a native-speaker panel. Sample: 165 pool tracks reachable through the public station queue (hi 24, kn 24, gu 20, ta 19, mr 19, te 18, bn 17, pa 15, ml 5, en 4). Raw rows: `lab/voice-pool/voice.json` in the project files. Cost about USD 0.2.

## Findings

| | |
|---|---|
| Lead gender | female 96 (58%), male 54 (33%), mixed 15 (9%) |
| Register | mid 155, high 10, low 0 |
| Timbre | bright 60, folk 53, warm 34, soft 14, classical-trained 4 |
| Singers | one 93, two 52, three or more 20 |
| Nativeness (1 to 5) | mean 3.9 overall; hi, kn, mr 4.0; ta 3.8 (4 of 19 at 3 or below); gu 3.85 (Hindi-influenced accent noted on 5 tracks); pa, bn, te about 3.9 |
| AI-sounding (1 to 5) | 3.0 to 3.1 in every language |

- **Skew**: Kannada is 21 female of 24; Tamil 13 of 19. A Kannada listener hears a male lead about one track in eight. Hindi, Marathi and Punjabi are balanced.
- **Narrow range**: no low voices at all and almost no high ones, and timbre collapses to bright, folk or warm. This matches the M2 lab result that voice descriptors barely move Lyria.
- **Nativeness is decent, not native**: the judge calls most tracks standard and native, but flags Hindi-influenced Gujarati and rural-leaning Tamil. The diction gate measures intelligibility only; nothing in the pool is gated on accent.

## Gender-cue test (6 Lyria clips, GBP 1.50 approved by S)

Same lyrics per language, 30 s, style prompt ending "Male lead vocal." or "Female lead vocal.", judged by the same Gemini voice judge. Raw: `lab/voice-pool/gender-cue-test.json`.

| Clip | Asked | Heard | Nativeness |
|---|---|---|---|
| hi | male / female | male / female | 4 / 4 |
| kn | male / female | male / female | 4 / 4 |
| ta | male / female | **female** / female | 3 / 4 |

Cue followed 5 of 6 times; the Tamil male ask came back as a female duet-like mix. n=6, so this supports shipping the choice, not promising it. Hindi and Kannada are reliable at this sample; Tamil male needs more renders, and so a chosen voice is checked after the render (`lib/voice/check.ts`, one Gemini listen) and re-rendered once on a clear miss; an unclear or failed check keeps the first render. A retry is a second Lyria spend (about GBP 0.25, on roughly 1 render in 6) through the same spend guard, and falls back to the first render if the guard refuses. Nativeness did not move with the cue.

## What is built (behind `VOICE_CHOICE=1`, off by default)

- `apps/web/lib/voice`: choices `station | female | male | duet`, Pro-only delivery styles, entitlement per tier, and the style-prompt hint. An entitlement miss degrades to the station mix.
- `POST /api/songs` accepts `voice` and stores it in the song metadata; `lib/agent/process.ts` appends the hint to the Lyria style prompt next to the diction hints.

| Tier | Voice |
|---|---|
| Free | Station mix (no hint) |
| Creator (INR 299), Station pass (INR 149) | Male or female lead |
| Pro (INR 799) | Adds duet and delivery styles |

## Before enabling

1. Confirm duet is audibly two voices (not tested; the 6-clip gender test covered male and female only).
2. Run the eval gate on the changed Lyria prompt (diction U and nativeness against the unhinted baseline).
3. Station side: rank for gender rotation so a listener's mix is not one voice for an hour; needs a `voice_gender` pool tag (new migration, not included here).
4. Native-speaker listen for ta and gu accent before any "native" claim (AGENTS.md rule 4).
