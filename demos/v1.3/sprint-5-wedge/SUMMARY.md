# Sprint 5 — Wedge: phoneme-correct Indic vocals

## Decision

The plan offered three candidate wedges:

- **A.** "The only AI music platform that gets Indian languages right at the phoneme level."
- **B.** "Editable music source documents — remix, fork, and own your song."
- **C.** "Raga-correct Carnatic and Hindustani sketches in under 30 seconds."

**Chose: A — phoneme-correct Indic vocals.**

Rationale:

1. v1.3 Sprint 4 just shipped the proof — `@neo-fm/g2p` rule packs for
   Hindi (schwa-deletion + nasal assimilation + voicing), Kannada
   (syllabification + virama gemination), Tamil canonicalisation, plus
   `RoutingVocalModel` actually consuming `section.phonemes`. The
   wedge claim is true *today* and falsifiable by listening to a
   single Hindi anchor.
2. Competitors (Suno, Udio, Riffusion, Boomy) demonstrably fail on the
   same minimal pairs — word-final schwas linger, anusvara collapses
   to a flat /n/, geminates merge. This is the defensibility moat.
3. Option B (editable Song Document) is a true differentiator but
   needs more UI investment than v1.3 owns to be a hero claim.
   Option C (latency) requires a verified DGX latency promise we
   haven't measured yet.

## Landing-page rewrite

`apps/web/app/(marketing)/page.tsx`:

- **Hero badge:** "Indic vocals, sung the way you wrote them"
- **H1:** "The only AI music platform that gets **Indian languages
  right at the phoneme level**."
- **Hero copy:** calls out schwa-deletion, anusvara assimilation,
  aspirated stops, geminated consonants by name.
- **Hero stats:** replaced "Languages / Styles / Output" with
  "G2P rule packs (हिन्दी ⋅ ಕನ್ನಡ ⋅ தமிழ்) / Co-composers /
  48 kHz stereo WAV".
- **Value props (4):** (1) Phoneme-correct Indic vocals, (2)
  Composition-aware structure, (3) Editable source documents,
  (4) Own what you make.
- **New section — `Listen`:** three anchor preset cards, each one
  naming a specific phonetic rule the rest of the field gets wrong
  (Hindi schwa drop on `namaskaar`, Kannada gemination on `namma`,
  Tamil canonicalisation).
- **How it works step 2** explicitly mentions "rule-packed G2P on
  every line so the singer gets phonemes, not graphemes."
- **Footer credit** updated to "Phoneme-correct AI music for Indian
  languages."

`apps/web/app/(marketing)/help/page.tsx`:

- Added a new top FAQ entry: *"Why do neo-fm's Indic vocals sound
  different from the other AI music tools?"* — describes the G2P
  pipeline in product language.
- Rewrote the "How does the full pipeline work?" entry to mention
  the phoneme stream.
- Expanded the "What languages can I sing in?" entry to spell out
  which languages have deep rule packs (Hindi/Kannada) vs
  canonicalisation only (Tamil), and that Hinglish routes through
  the Hindi rule pack.

## Tests + axe + Lighthouse

Added `apps/web/tests/e2e/landing.spec.ts` with three guarantees:

1. `<h1>` contains the substring `phoneme` and `Indian languages`.
   This pins the wedge into HTML — accidental edits that lose the
   word will fail CI loudly.
2. The "Hear the difference" section exists, and each of the three
   anchor preset links (`hindustani-khayal-sketch`, `kannada-bhavageete`,
   `tamil-folk`) is reachable from the landing page.
3. axe critical/serious violations = 0 on the anon landing.

Lighthouse + Playwright runs land in `demos/v1.3/sprint-5-wedge/`.

## Ralph gate

- [x] Wedge picked and justified in writing.
- [x] H1 contains the wedge keyword `phoneme` (asserted by Playwright).
- [x] Listen section ships with 3 anchor presets, one per Indic
      language family.
- [x] Help page rewritten in product language with the phoneme
      promise as the lead.
- [x] `pnpm --filter @neo-fm/web lint` green.
- [x] `pnpm --filter @neo-fm/web typecheck` green.
- [x] `pnpm --filter @neo-fm/web test` green (120 / 120).
- [ ] Lighthouse + e2e land in Sprint 6's full QA sweep.

## Out of scope (handed to Sprint 6)

- Real audio assets for the three Listen samples — the Listen
  section currently links to the templates that *would* produce
  the samples. Sprint 6 will render the three anchors with the
  v1.3 pipeline and drop them in the public-domain assets bucket.
- Lighthouse re-run on the rewritten page — folded into Sprint 6's
  QA sweep so we measure once after all v1.3 changes have landed.
