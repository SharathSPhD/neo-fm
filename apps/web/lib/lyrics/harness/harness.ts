import { critiquePrompt, parseCritique, parseSelect, revisePrompt, selectPrompt } from "./critique";
import { exemplarBlock, retrieveExemplars } from "./exemplars";
import { playbookFor } from "./playbook";

/** One configured way of turning drafts into final lyrics. Everything optional is off by default so each lever can be measured alone. */
export interface HarnessConfig {
  /** quality references retrieved from the judged corpus and shown to the polisher (0 = none) */
  exemplars: number;
  /** per-language craft notes distilled from judged pairs */
  playbook: boolean;
  /** critique-and-revise rounds after the polish (0 = none) */
  rounds: number;
  /** a revision is kept only when the blind pairwise judge prefers it over the previous version */
  guard: boolean;
  /** polish this many drafts and let a blind listwise judge pick (1 = no selection) */
  candidates: number;
  /** polish returns only the changed lines (PCE_POLISH_EDITS) instead of the whole lyric */
  edits?: boolean;
  /** polish model override (lab only); unset = the live polish model */
  model?: string;
  /** Studio: the drafts are written by this model (lab only), `draftCount` of them, instead of taken from the input */
  draftModel?: string;
  draftCount?: number;
  /** model that picks among the Studio drafts before the polish (default: the critic model) */
  pickModel?: string;
}

export const ARMS: Record<string, HarnessConfig> = {
  live: { exemplars: 0, playbook: false, rounds: 0, guard: false, candidates: 1 },
  refs: { exemplars: 3, playbook: true, rounds: 0, guard: false, candidates: 1 },
  refs6: { exemplars: 6, playbook: true, rounds: 0, guard: false, candidates: 1 },
  revise: { exemplars: 0, playbook: false, rounds: 1, guard: true, candidates: 1 },
  refs_revise: { exemplars: 3, playbook: true, rounds: 2, guard: true, candidates: 1 },
  pick3: { exemplars: 3, playbook: true, rounds: 0, guard: false, candidates: 3 },
  live_edits: { exemplars: 0, playbook: false, rounds: 0, guard: false, candidates: 1, edits: true },
  opus: { exemplars: 0, playbook: false, rounds: 0, guard: false, candidates: 1, model: "claude-opus-5-5" },
  refs_opus: { exemplars: 3, playbook: true, rounds: 0, guard: false, candidates: 1, model: "claude-opus-5-5" },
  // Studio: three Opus drafts, an Opus pick, then the Opus refs polish. Not in production; gated against refs_opus and live first.
  full_opus: { exemplars: 3, playbook: true, rounds: 0, guard: false, candidates: 1, model: "claude-opus-5-5", draftModel: "claude-opus-5-5", draftCount: 3, pickModel: "claude-opus-5-5" },
  full: { exemplars: 3, playbook: true, rounds: 2, guard: true, candidates: 3 },
};

export interface HarnessInput {
  language: string; style: string; brief: string; drafts: string[];
  /** craft notes to use instead of the shipped playbook (lets a freshly distilled playbook be tested before it is committed) */
  playbook?: string;
}

export interface HarnessDeps {
  /** the production polish step with the given extra brief text appended (blocks may be empty) */
  polish: (a: { language: string; style: string; brief: string; lyrics: string }) => Promise<string>;
  /** plain model call used for critique, revision and selection */
  ask: (a: { model: string; prompt: string; maxTokens: number }) => Promise<string>;
  /** true when `revised` beats `previous` under the blind both-orders pairwise judge */
  prefers: (a: { language: string; brief: string; revised: string; previous: string }) => Promise<boolean>;
  /** Studio drafting: one draft from `draftModel` (only called when the arm sets it) */
  draft?: (a: { model: string; language: string; style: string; brief: string; index: number; of: number }) => Promise<string>;
  /** deterministic shuffle so selection is blind to draft order and reproducible per brief */
  shuffle?: <T>(xs: T[]) => T[];
}

export interface HarnessResult { lyrics: string; trace: string[] }
/** The corpus context appended to the polish brief: craft notes for the language plus judge-picked exemplars ("" when neither exists). */
export function refsContext(input: { language: string; style: string; brief: string }, exemplars: number, playbook: string): { text: string; exemplars: number; ids: string[] } {
  const ex = exemplars > 0 ? retrieveExemplars(input, exemplars) : [];
  const text = [playbook && `CRAFT NOTES (${input.language}; distilled from lyrics that judges preferred):\n${playbook}`, exemplarBlock(ex)].filter(Boolean).join("\n\n");
  return { text, exemplars: ex.length, ids: ex.map((e) => e.id) };
}

const CRITIC_MODEL = "claude-sonnet-5-5";

export async function runHarness(cfg: HarnessConfig, input: HarnessInput, deps: HarnessDeps): Promise<HarnessResult> {
  const trace: string[] = [];
  const playbook = cfg.playbook ? (input.playbook || playbookFor(input.language)) : "";
  const ctx = refsContext(input, cfg.exemplars, playbook);
  const brief = ctx.text ? `${input.brief}\n\n${ctx.text}` : input.brief;
  if (ctx.exemplars || playbook) trace.push(`context: ${ctx.exemplars} exemplars${ctx.ids.length ? ` [${ctx.ids.join(",")}]` : ""}${playbook ? " + playbook" : ""}`);

  const refine = async (first: string): Promise<string> => {
    let cur = first;
    for (let r = 0; r < cfg.rounds; r++) {
      const crit = parseCritique(await deps.ask({ model: CRITIC_MODEL, prompt: critiquePrompt({ ...input, lyrics: cur, playbook }), maxTokens: 2500 }));
      if (!crit || crit.verdict === "keep") { trace.push(`round ${r + 1}: ${crit ? "keep" : "unparseable critique"}`); break; }
      const revised = (await deps.ask({ model: CRITIC_MODEL, prompt: revisePrompt({ ...input, lyrics: cur, critique: crit, playbook }), maxTokens: 4000 })).trim();
      if (revised.length < 20) { trace.push(`round ${r + 1}: empty revision`); break; }
      const ok = cfg.guard ? await deps.prefers({ language: input.language, brief: input.brief, revised, previous: cur }) : true;
      trace.push(`round ${r + 1}: ${crit.weak.length} lines flagged, revision ${ok ? "kept" : "rejected by judge"}`);
      if (!ok) break;
      cur = revised;
    }
    return cur;
  };

  let sourceDrafts = input.drafts;
  if (cfg.draftModel && cfg.draftCount && deps.draft) {
    const n = cfg.draftCount;
    const written = (await Promise.all(Array.from({ length: n }, (_, i) => deps.draft!({ model: cfg.draftModel!, language: input.language, style: input.style, brief: input.brief, index: i + 1, of: n }).catch(() => "")))).filter((d) => d.length >= 20);
    trace.push(`studio drafts: ${written.length}/${n} written by ${cfg.draftModel}`);
    if (written.length > 0) {
      const order = (deps.shuffle ?? ((xs) => xs))(written.map((_, i) => i));
      // Opus always thinks: a 400-token cap left the pick reply empty in the first live run, so the pick gets 3000.
      const pick = written.length === 1 ? 0 : parseSelect(await deps.ask({ model: cfg.pickModel ?? CRITIC_MODEL, prompt: selectPrompt({ ...input, cands: order.map((i) => written[i]!) }), maxTokens: 3000 }), order.length);
      const chosen = pick === null ? 0 : written.length === 1 ? 0 : order[pick]!;
      trace.push(`studio pick: draft ${chosen + 1}${pick === null ? " (unparseable pick)" : ""}`);
      sourceDrafts = [written[chosen]!];
    }
  }
  const drafts = sourceDrafts.slice(0, Math.max(1, cfg.candidates));
  if (drafts.length === 0) throw new Error("no drafts to polish");
  const finals: string[] = [];
  for (const d of drafts) finals.push(await refine(await deps.polish({ language: input.language, style: input.style, brief, lyrics: d })));
  if (finals.length === 1) return { lyrics: finals[0]!, trace };

  const order = (deps.shuffle ?? ((xs) => xs))(finals.map((_, i) => i));
  const pick = parseSelect(await deps.ask({ model: CRITIC_MODEL, prompt: selectPrompt({ ...input, cands: order.map((i) => finals[i]!) }), maxTokens: 200 }), order.length);
  trace.push(`selected candidate ${pick === null ? "0 (unparseable pick)" : order[pick]}`);
  return { lyrics: finals[pick === null ? 0 : order[pick]!]!, trace };
}
