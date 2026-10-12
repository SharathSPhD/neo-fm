# pce-poem port - fidelity vs. the Pratyabhijna plugin (v0.4)

| Plugin capability | This port | Gap |
|---|---|---|
| `cascade` tool (iccha->apohana->jnana->kriya->vimarsa, shadow revision, commit policy) | Same operator order, executed as skill steps; candidate generation by worker agents | Equivalent *protocol*, not equivalent *numerics* |
| apohana: cosine to constraint minus max cosine to must_avoid embeddings | LLM-judged closeness, min-max normalised | No real embeddings -> noisier, not reproducible |
| ananda: coherence, distinct-n, regex/syllable check, cross-encoder | Rubric scoring by the model (syllable counts still explicit) | Not the learned/regex scorer |
| jnana: Dirichlet BMR with gammaln free energy | Closed-form pseudo-count posterior, argmax | No true delta-F / BMR |
| vimarsa thresholds (novelty .30, aesthetic .40, dF .05) | Same thresholds, judged values | dF is approximate |
| Hopfield storehouse, SWS/REM consolidation, learned gate, `judge_pair`, audit hooks | **Not ported** | Missing: no cross-session memory of good surfaces |
| 20 MCP tools / 5 agents / 5 commands | 1 skill (poem) | aut/interpret/audit/cascade-debug not ported |

## Path to full fidelity (recommended next)
1. Vendor `src/pce/{operators,policies,active_inference}` as a small pip package; swap the
   `claude --print` substrate (`HaikuLM`) for an Anthropic SDK substrate and the
   sentence-transformers embedder for an ONNX embedder (fastembed). Run it as an
   MCP server the agent reaches over `allow_mcp_servers`, hosted on Vercel/Fly (no DGX).
2. Back the Hopfield store with Supabase (pgvector) and attach a memory store so
   consolidation persists per tenant.
3. Re-run the plugin's own benchmarks (`benchmarks/`) against the port to quantify the gap.


## Update: real engine port (`pce-engine/`)
Probe of the Managed Agents sandbox (admin route `/api/admin/ma-sandbox`): Python 3.11, numpy 2.4, scipy 1.17,
4 vCPU, 16 GB RAM; **no pip index, no Hugging Face, no outbound API** (`networking: limited`). The plugin's
operators need only numpy + scipy (`gammaln`); torch/transformers/sentence-transformers are used solely by the
embedder and the local LM. So the *unmodified* `pce` operators and `run_cascade` (iccha best-of-K with prompt
perturbations, apohana, ananda, jnana Dirichlet BMR, vimarsa gate, shadow revision, commit policy, free-energy
budget, Hopfield store) are vendored in `pce-engine/pce` and run inside the sandbox via `run_cascade.py`,
with the agent acting as the language model (`ReplayLM`: round 1 asks for K draft candidates, round 2 for K
revision candidates built from the cascade's own reviser brief). No numerics are re-implemented.

Closed: real jnana/vimarsa numerics, commit policy, audit, budget gate, best-of-K width + perturbation table.
Open: (1) the embedder is a lexical hash n-gram stand-in -> cross-lingual coherence/apohana/aspect cosines are
near zero for Indic text (observed: aspect_count 0, delta_F 0 on a Kannada test), so vimarsa rarely fires.
A multilingual embedding model is the one real compute need (CPU, ~100 MB, stateless). (2) Hopfield store
persistence (Supabase pgvector) and consolidation. (3) `audit` and `interpret` are ported as offline, read-only commands (`pce-engine/pce_tools.py`, 2026-10-12); `aut` and `cascade-debug` are not (no design in this repo; see PR notes).
