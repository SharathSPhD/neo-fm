# Lyria spend log

All figures are estimates at GBP 0.25 per successful render (`LYRIA_COST_GBP_FULL`), not Google billing data.
Refused renders (moderation, Lyria 400, no audio part) are not counted. Long tracks (about 150 s) are counted at the same flat rate, so their real cost is unknown until billing is checked.

| Date | Batch | Renders | Est. GBP | Admitted | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-10-18 | occasion samples | 10 | 2.50 | 7 | samples/occasion |
| 2026-10-18 | pool wave 1 | 24 | 6.00 | 18 | approved GBP 26 |
| 2026-10-18 | pool wave 2 | 76 | 19.00 | 65 | 3 refused by Lyria |
| 2026-10-18 | P5 gap tracks, first four | 4 | 1.00 | 4 | 2 Hinglish, 1 film, 1 Diwali |
| 2026-10-18 | P5 gap tracks | 11 | 2.75 | 9 | Diwali, Hinglish, energy, film |
| 2026-10-18 | P3 long tracks (150 s) | 6 | 1.50 | 6 | 2 refused by moderation |
| 2026-10-18 | gap tracks in ta/te/kn/bn (stored PCE lyrics) | 15 | 3.75 | 14 | Diwali, wedding, harvest, joyful |
| 2026-10-18 | English tracks | 4 | 1.00 | 4 | 6 lyrics refused by moderation (4 English, 2 long), not billed |
| 2026-10-18 | style coverage ta/te/kn/bn (stored PCE lyrics, new style hints) | 18 | 4.50 | 16 | S tapped GBP 5 at 16:39Z; 1 refused by moderation, 1 Lyria 429 quota error (not billed); rejected by the diction gate: ta-7 lullaby, bn-30 nazrul geeti |
| 2026-10-18 | Lyria language A/B (ta/te/kn/bn, not pooled) | 16 | 4.00 | n/a | scored only, see pool/lyria-lang-ab.md |

Pool renders: GBP 25.00 of the GBP 26 approved, then GBP 14.00 of the extra GBP 15 (the GBP 2.50 occasion samples came from the earlier GBP 3 test budget). Pool: 149 admitted, 24 retired duplicates, 23 rejected by the diction gate.
Approvals: GBP 26 (pool), then GBP 15 more for gap and long tracks (S, 2026-10-18 13:35 UTC).
Style coverage: GBP 4.50 of the GBP 5 S approved on 2026-10-18 (tap, 16:39Z). Google returned a 429 quota error on the last render, so further renders may be blocked until the quota resets.
