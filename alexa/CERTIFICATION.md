# Alexa certification checklist (neo-fm skill)

Nothing here is submitted. Submission, the Amazon developer account and any beta invitations need S. Items marked *unverified* come from secondary sources; read Amazon's current Policy Requirements and certification pages before relying on them.

## Already in the repo
- [x] AudioPlayer enabled in `skill-package/skill.json`; required `AMAZON.PauseIntent` / `ResumeIntent` plus the recommended playback intents are in both interaction models (tested).
- [x] Stream URLs are HTTPS on 443 with a trusted certificate (Supabase Storage signed URLs); MP3 is a supported format.
- [x] Request signature, timestamp and application-id checks on `/api/alexa`; fails closed without `ALEXA_SKILL_ID`.
- [x] No purchases, ads or personal data (declared in the manifest). No account linking in v1.
- [x] The skill states on launch that every song is made by AI; the on-screen subtitle repeats it.
- [x] Unsupported intents (loop, shuffle, repeat, start over, previous) answer politely instead of failing.
- [x] Testing instructions drafted in `skill.json`.

## Before submission (human or thread, in this order)
1. [ ] **S creates the Amazon developer account** and a custom skill; give the skill id to the coordinator. Set `ALEXA_SKILL_ID` and `ALEXA_SKILL_ENABLED=1` in Vercel (prod change, S's go).
2. [ ] `ask deploy` this folder (needs the ASK CLI logged in as S) and build the models.
3. [ ] **ASK simulator / Alexa Developer Console test tab** for every phrase in the table below, en-IN first.
4. [ ] **On a real Echo:** confirm the signed URL plays (Content-Type `audio/mpeg`), queue-to-queue transitions are gapless, pause/resume/stop work, and the invocation name "neo f m" is recognised. Fix the name if misheard.
5. [ ] Run the **Skill Validation API** via the ASK CLI; certification needs an overall SUCCESSFUL status (music/radio/podcast testing guide).
6. [ ] **Beta test** with up to 500 testers (start with about 20 friends and family).
7. [ ] **Gemini nativeness score for the hi-IN copy** (manifest and speech strings), per S: Gemini scoring, no human readers for now (`launch/indic-copy-review.md`). Use only the already-approved Gemini budget, and do not submit hi-IN before it passes.
8. [ ] Privacy policy URL and terms URL on the manifest, plus 108 px and 512 px icons. `/trust` and the privacy page should mention voice-assistant use first.
9. [ ] Confirm current Alexa policy text on AI-generated content and on audio skills (*unverified*), and that "India only" matches the en-IN / hi-IN publishing rule.
10. [ ] S approves the store listing copy and submits.

## Phrases to test (en-IN)
| Say | Expect |
|---|---|
| "Alexa, open neo f m" | "Every song here is made by AI", then music |
| "Alexa, ask neo f m to play Tamil" / Hindi / Telugu / Kannada / Bengali / English | Language locked; later tracks stay in it |
| "next", "skip", remote next button | A different track, no recent repeats |
| "more like this" | Next track resembles the playing one |
| "something calmer" / "something livelier" | Next track shifts energy |
| "pause", "resume", "stop", "cancel" | Stops; resume continues from where it paused |
| "previous", "loop", "shuffle", "repeat", "start over" | Spoken explanation, music not interrupted |
| Let a track finish | Next one starts without a gap |
| Empty pool (flag on, pool unavailable) | Spoken "station is quiet" message, no crash |

## Known limits of v1
Listeners are anonymous (no taste carry-over). "Alexa, play neo-fm" does not work for a custom skill; users say "open neo f m". Tamil, Telugu, Kannada and Bengali are spoken as language names inside en-IN / hi-IN; there are no custom-skill locales for them *(unverified)*. Voice prompts are English and Hindi only.
