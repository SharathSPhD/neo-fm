# License review — `kenpath/svara-tts-v1`

Date: 2026-05-15
Reviewer: in-band agent on `spark-5208`
Source: <https://hf.co/kenpath/svara-tts-v1>
HF repo metadata at review time: `license: apache-2.0`, gated: no

## Base-model chain

`kenpath/svara-tts-v1`
  → fine-tuned (LoRA + GGUF variants) from
`canopylabs/3b-hi-ft-research_release`  *(Apache-2.0, **gated**)*
  → fine-tuned from
`canopylabs/orpheus-3b-0.1-pretrained`  *(Apache-2.0, **gated**)*
  → fine-tuned from
`meta-llama/Llama-3.2-3B-Instruct`  *(Llama 3.2 Community License)*

### Llama 3.2 Community License: relevant clauses for this project

- **Permissive commercial use** is allowed *unless* monthly active
  users exceed 700 million (Meta's "very large platform" threshold).
  Neo-FM is years from that bar; treat as allowed.
- **Attribution required**: "Built with Meta Llama 3.2" plus the
  Acceptable Use Policy URL. We will surface that in the same UI
  credits panel that ADR 0010 already requires for attribution.
- **Acceptable Use Policy compliance**: no military, no targeted
  harassment, no CSAM, etc. Standard.
- **No use of Llama outputs to train other LLMs**, but vocal synthesis
  is not "training another LLM"; we use Llama outputs only as audio
  tokens fed to the Orpheus codec.

## ADR 0010 evidence checklist

1. **License grant on file.** Apache-2.0 + Llama 3.2 Community.
   Both are public, machine-readable on the upstream HF repos.
   `<sha256-of-LICENSE>` is captured at operator-handoff time when the
   model is first downloaded to disk (see `kenpath--svara-tts-v1.LICENSE.sha256`).
2. **Attribution surface decided.** A "Credits" footer / metadata
   field on tracks generated with this model. Tracked as a Phase 7
   task; see [docs/IMPLEMENTATION_PLAN.md] under Phase 7.
3. **Commercial use confirmed compatible.**
   - Self-hosted inference: yes (Apache-2.0 on the TTS adapter,
     Apache-2.0 on the two Orpheus base layers, Llama 3.2 Community
     on the foundation model; all three permit self-hosted inference
     for commercial users).
   - Paid-tier users: yes.
   - Third-party hardware (DGX): yes; the licenses do not restrict
     hardware.
4. **No CC-NC, no research-only, no "ask permission per use".**
   The "research_release" suffix in `canopylabs/3b-hi-ft-research_release`
   refers to the *artifact name*, not the license. The actual license
   field on that HF repo is `apache-2.0`. The fact that the repo is
   *gated* means HF requires the operator to accept terms before
   downloading, not that the model is research-only.

## Decision

**ACCEPT** as a Phase 7 vocal-synth candidate. Implementation may
proceed against `kenpath/svara-tts-v1` once the Phase 7 worktree is
opened.

## Operator action required before code lands

1. From a logged-in HF account (`hf auth login`), accept the gated
   terms on the two upstream Orpheus repos. The kenpath repo itself
   is not gated.
2. Run `scripts/download-heartmula.py`-style fetch into
   `/home/sharaths/models/svara-tts-v1/`.
3. `sha256sum LICENSE > docs/licenses/kenpath--svara-tts-v1.LICENSE.sha256`
4. Add the matching `Llama-3.2 LICENSE` sha256 file next to it.

These four steps land in Phase 7's bring-up runbook, not as
prerequisite operator handoff -- they happen alongside the Phase 7
code that consumes the weights.
