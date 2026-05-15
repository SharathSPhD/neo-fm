# License review — `ai4bharat/indic-parler-tts`

Date: 2026-05-15
Reviewer: in-band agent on `spark-5208`
Source: <https://hf.co/ai4bharat/indic-parler-tts>
HF repo metadata at review time: `license: apache-2.0`, **gated**

Sibling: `ai4bharat/indic-parler-tts-pretrained` (also Apache-2.0,
gated). Both share the same parler_tts architecture and the same
license; the non-pretrained model is the recommended inference target.

## Languages covered

Per repo metadata: en, as, bn, gu, hi, **kn** (Kannada), ks, or, ml,
mr, ne, pa, sa, sd, ta, te, ur, om.

Kannada and Sanskrit are both first-class, which matches the
India-first language posture in [PRD §1] / [SPEC §1].

## ADR 0010 evidence checklist

1. **License grant on file.** Apache-2.0, captured on the HF model
   card and the in-tree LICENSE blob. The reference paper
   (arXiv:2402.01912) does not impose a stricter clause; the model
   release supersedes the paper for license terms.
2. **Attribution surface decided.** Required for the dataset
   `ai4b-hf/GLOBE-annotated` and for the AI4Bharat org per Apache-2.0
   conventions. Same UI credits surface as `kenpath/svara-tts-v1`.
3. **Commercial use confirmed compatible.**
   - Self-hosted inference: yes.
   - Paid-tier users: yes.
   - Gated access: HF requires `hf auth` + accept terms.
     Acceptance is a one-off operator step, not a per-use license.
4. **No CC-NC, no research-only.** Apache-2.0 throughout.

## Decision

**ACCEPT** as a Phase 7 vocal-synth candidate. Two viable models on
file (this one + `kenpath/svara-tts-v1`) satisfies ADR 0010's
"at least one viable model" trigger.

## Why we list two

Carrying two compatible options de-risks Phase 7: if one upstream
re-licenses or removes the model, the other keeps Phase 7 shippable.
Selection between them at Phase 7 time will be driven by qualitative
A/B on Indic prosody + Kannada coverage, not by license posture.

## Operator action required before code lands

1. `hf auth login` with an HF account that has accepted the gated
   terms for both `ai4bharat/indic-parler-tts` and
   `ai4bharat/indic-parler-tts-pretrained`.
2. Mirror the operator steps for the kenpath model:
   - download weights to `/home/sharaths/models/indic-parler-tts/`
   - `sha256sum LICENSE > docs/licenses/ai4bharat--indic-parler-tts.LICENSE.sha256`
