# neo-fm Alexa skill (prototype)

A custom Alexa skill using the AudioPlayer interface that plays the station: "Alexa, open neo f m", "ask neo f m to play Tamil", next, more like this, calmer, livelier, pause, resume, stop.

- `skill-package/` is the ASK CLI layout: `skill.json` (manifest, India only, no ads or purchases) and the en-IN and hi-IN interaction models. The hi-IN wording is a first pass and is gated on a Gemini nativeness score (S: no human readers for now; see `launch/indic-copy-review.md`) before certification.
- The endpoint is `POST /api/alexa` (`apps/web/app/api/alexa/route.ts`). It returns 404 unless `ALEXA_SKILL_ENABLED=1`, and rejects any request that fails Alexa's signature or timestamp check or whose application id differs from `ALEXA_SKILL_ID`.
- Skill logic is in `apps/web/lib/alexa/skill.ts` (pure, tested in `apps/web/tests/alexa-skill.test.ts`); the tracks come from the same pool, ranking and clock wheel as `/api/station/queue` (`lib/alexa/tracks.ts`). Listeners are anonymous; account linking is a later step.
- Not yet tested on a device or in the ASK simulator: that needs an Amazon developer account (S-owned). Then `ask deploy` this folder, set `ALEXA_SKILL_ID` and `ALEXA_SKILL_ENABLED=1` in Vercel.

Certification checklist: `CERTIFICATION.md`. Plan and partnership research: `strategy/alexa-partnerships.md` in the project files.
