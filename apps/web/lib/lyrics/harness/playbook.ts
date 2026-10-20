import data from "./data/playbooks.json";
import { langCode } from "./exemplars";

const PLAYBOOKS = data as Record<string, string>;

/** Craft notes distilled by Claude from the judge-labelled chosen/rejected pairs of one language ("" when none exists yet). */
export function playbookFor(language: string): string {
  return PLAYBOOKS[langCode(language)] ?? "";
}

export function distillPrompt(a: { language: string; pairs: { brief: string; chosen: string; rejected: string }[] }): string {
  return `You are a senior lyricist and editor in ${a.language}. Below are ${a.pairs.length} pairs of 30-second song lyrics for the same brief. In each pair a panel of AI judges preferred the CHOSEN lyric over the REJECTED one (judges scored meter, rhyme, imagery, diction, cultural fit, brief fidelity).
Study what separates them and write a compact playbook for an editor polishing new lyrics in ${a.language}:
- up to 8 CRAFT RULES that explain what the chosen lyrics do better (concrete: diction, imagery, rhyme and line-length habits, how the brief is honoured)
- up to 6 FAILURE PATTERNS seen in rejected lyrics (stock phrases, invented words, translated-sounding phrasing, forced rhyme, ignoring the brief)
Cite short native-script phrases only as examples of a pattern, never whole lines. Each item is one sentence. No preamble.

${a.pairs.map((p, i) => `### PAIR ${i + 1}\nBrief: ${p.brief}\nCHOSEN:\n${p.chosen}\nREJECTED:\n${p.rejected}`).join("\n\n")}`;
}
