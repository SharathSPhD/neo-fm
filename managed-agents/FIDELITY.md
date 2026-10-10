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
