# Handoff (session restart, 2026-10-12)

Branch `claude/sleepy-keller-8eiz4s` (head 807733c+). Prod DB: neo-fm-prod `kgxltxvjlsnbwomklwox` (migrations through 0062). Preview with prod DB: latest deploy of that branch.

## In flight / resume first (updated: eval DONE, see EVAL-PCE.md; Telugu pronunciation 51% -> 99%; self-improve loop live, first candidate rejected)
1. **Eval (150 briefs)**: batches in `eval_runs`/`eval_judgments` on neo-fm-prod. `fullA` = raw PCE vs best-of-6 baseline (149/150 PCE done; bn-27 failed), `fullB` = PCE + old Sonnet polish vs same baseline (117/150 judged so far: PCE 68, other 31, tie 18, sign p<0.001; per-dim imagery +0.49, originality +0.64, cultural +0.27, diction ~0, prosody -0.32), `fullC` = PCE + meter-lint polish (not started). Admin route `/api/admin/pce-eval` actions: start, advance, polishcopy (`batch=fullA&to=fullC`), gjudge (Gemini 2nd judge), report. Driver loops were in the session scratchpad (eval_full.sh, eval_p2.sh); recreate by looping those actions (bearer = AGENT_TICK_SECRET; a preview needs a fresh `_vercel_share` link). Remaining: finish fullB judging, run fullC, run Gemini judge on both, report agreement; then update the PCE marketing claim.
2. **Diction**: romanized singing script (lib/diction/romanize.ts) deployed on 807733c; verify with a Telugu job (job c5518d12... was processing): compare `agent_runs.diction_qa.matchPct` (previous Telugu 59%).
3. **Quality gates**: CI on `claude/**` must be green (check ci.yml runs); local `pnpm --filter @neo-fm/web exec vitest run` = 286 pass; Playwright (E2E_SLOW unset) 40 pass.
4. Pending per plan: song-ready email (needs Resend key in Supabase secrets), Supabase Pro, Stripe webhook, GoDaddy NS, grievance mailbox (see CUTOVER.md "What I still need from you").
5. e2e-bot@neo-fm.test is tier=pro (test user; remove before launch).
