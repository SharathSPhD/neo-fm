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
| 2026-10-19 | council wave (hi, te, bn, Hinglish; stored PCE lyrics, Hinglish authored) | 45 | 11.25 | 42 | S typed the GBP 17.50 approval 2026-10-18 17:36Z; hi 16, te 9, bn 5, Hinglish 12 admitted; 3 rejected by the diction gate; 7 refused; Hinglish capped at 12 and 3 planned items skipped per the coordinator steer |
| 2026-10-19 | 30 s Flash clips (te, kn, ta, hi; stored PCE lyrics cut to 4 lines) | 34 | 1.70 | 24 | S tapped 40 clips for GBP 2 at 09:09Z; first 8 clips (GBP 0.40) all rejected because the gate scored the whole lyric (fixed in #321); then 26 renders: te 11, kn 5, ta 5, hi 3 admitted, 2 rejected, 6 refused by moderation |
| 2026-10-19 | high-energy male-lead wave (kn, ta) | 12 | 3.00 | 12 | S tapped GBP 6.25 at 07:59Z 2026-10-19; kn 8 and ta 4 admitted; rest of the plan paused by the launch budget rule |
| 2026-10-20 | long 150 s indie/lofi night tracks (kn 3, te 3, ta 2; stored PCE lyrics) | 8 | 2.00 | 8 | S tapped 8 tracks for GBP 2 at 07:09Z; all admitted (diction 85-100), 147-153 s, energy low, daypart night |
| 2026-10-20 | gap top-up (hi, te, kn, ta; stored fullC lyrics) | 10 | 2.50 | 10 | S tapped 10 tracks for GBP 2.50 at 07:36Z; night indie/lofi 5, high-energy male film 3, devotional 2 (tagged dawn, not dusk); 120-157 s, diction 84-97, 0 refused |
| 2026-10-20 | dusk top-up (hi 2, te 1, kn 1, ta 2; festive light-classical, stored fullC lyrics) | 6 | 1.50 | 6 | S tapped 6 tracks for GBP 1.50 at 09:07Z; 121-126 s, diction 86-97, 0 refused; ingest tagged morning first then dusk; daypart fix to dusk first pending S |
| 2026-10-18 | Lyria language A/B (ta/te/kn/bn, not pooled) | 16 | 4.00 | n/a | scored only, see pool/lyria-lang-ab.md |

Pool renders: GBP 25.00 of the GBP 26 approved, then GBP 14.00 of the extra GBP 15 (the GBP 2.50 occasion samples came from the earlier GBP 3 test budget). Pool: 149 admitted, 24 retired duplicates, 23 rejected by the diction gate.
Approvals: GBP 26 (pool), then GBP 15 more for gap and long tracks (S, 2026-10-18 13:35 UTC).
Style coverage: GBP 4.50 of the GBP 5 S approved on 2026-10-18 (tap, 16:39Z). Google returned a 429 quota error on the last render, so further renders may be blocked until the quota resets.
Council wave: GBP 11.25 of the GBP 17.50 S approved (2026-10-18 17:36Z); GBP 6.25 unspent.
