# docs/licenses

License artifacts for third-party model weights and datasets used in
this repo, per [ADR 0010](../DECISIONS/0010-vocal-stack-licensing.md).

Each candidate gets one file:

- `<repo>.LICENSE.sha256` — `sha256sum` of the LICENSE blob from the
  upstream artifact, captured by the operator at the time of intake.
- `<repo>.review.md` — date-stamped human review covering: license,
  attribution requirement, commercial-use confirmation, gated-access
  status, base-model chain, and the decision (accept / reject).

The naming convention is the upstream repository identifier with `/`
replaced by `--` (e.g. `kenpath--svara-tts-v1.review.md`).

## Current status (Phase 7 gate)

| Candidate                                          | License     | Commercial? | Status     |
| -------------------------------------------------- | ----------- | ----------- | ---------- |
| `kenpath/svara-tts-v1`                             | Apache-2.0  | yes (gated) | **accept** |
| `ai4bharat/indic-parler-tts`                       | Apache-2.0  | yes (gated) | **accept** |
| `ai4bharat/indic-parler-tts-pretrained`            | Apache-2.0  | yes (gated) | accept     |
| IIT-M `svara-tts` (research papers, not on HF)     | unknown     | unknown     | defer      |
| IITM-CLS (phoneme inventory, not redistributed)    | n/a         | inventory   | accept     |

Phase 7 may proceed against `kenpath/svara-tts-v1` and/or
`ai4bharat/indic-parler-tts`. See the per-model `.review.md` files for
the base-model chain analysis and the gated-access workflow.
