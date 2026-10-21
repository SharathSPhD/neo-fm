/**
 * Prompt regression on fixed kn / hi / en briefs, no model calls.
 *  1. The polish prompt, assembled exactly as the render step does it (template + brief + refs and craft notes), must equal the
 *     recorded prompt. Any wording, exemplar-retrieval or playbook change shows up as a diff here; the diff is what the PR's
 *     "Eval-gate:" reference has to justify (scripts/prompt-guard.mjs).
 *  2. Recorded lab outputs for the same briefs must keep clearing the free lyric-metric floors, so the metrics themselves can't drift.
 * Regenerate the recorded prompts on purpose with: UPDATE_PROMPT_FIXTURES=1 pnpm --filter @neo-fm/web exec vitest run tests/prompt-regression.test.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { ARMS, refsContext } from "../lib/lyrics/harness/harness";
import { playbookFor } from "../lib/lyrics/harness/playbook";
import { DEFAULT_POLISH_TEMPLATE, polishLyrics } from "../lib/lyrics/polish";
import { detectScript, lineProsody } from "../lib/diction";
import { singableLines } from "../lib/lyrics/singable";

const DIR = join(__dirname, "fixtures", "prompt-regression");
interface Case { id: string; language: string; style: string; brief: string; draft: string; output: string }
const cases = JSON.parse(readFileSync(join(DIR, "briefs.json"), "utf8")) as Case[];
const EXPECTED_PATH = join(DIR, "expected-prompts.json");

async function assemble(c: Case): Promise<{ prompt: string; refs_ids: string[] }> {
  const refs = refsContext({ language: c.language, style: c.style, brief: c.brief }, ARMS.refs!.exemplars, playbookFor(c.language));
  const brief = refs.text ? `${c.brief}\n\n${refs.text}` : c.brief;
  let prompt = "";
  const client = { messages: { create: async (req: { messages: { content: string }[] }) => { prompt = req.messages[0]!.content; return { content: [{ type: "text", text: "x".repeat(40) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "end_turn" }; } } } as unknown as Anthropic;
  await polishLyrics(client, { language: c.language, style: c.style, brief, lyrics: c.draft }, DEFAULT_POLISH_TEMPLATE);
  return { prompt, refs_ids: refs.ids };
}

describe("polish prompt regression (kn / hi / en)", () => {
  it("matches the recorded assembled prompts", async () => {
    const got: Record<string, { prompt: string; refs_ids: string[] }> = {};
    for (const c of cases) got[c.id] = await assemble(c);
    if (process.env.UPDATE_PROMPT_FIXTURES === "1") { writeFileSync(EXPECTED_PATH, JSON.stringify(got, null, 1) + "\n"); return; }
    const want = JSON.parse(readFileSync(EXPECTED_PATH, "utf8")) as typeof got;
    for (const c of cases) {
      expect(got[c.id]!.refs_ids, `${c.id}: retrieved refs changed`).toEqual(want[c.id]!.refs_ids);
      expect(got[c.id]!.prompt, `${c.id}: the assembled polish prompt changed. If intended, regenerate the fixtures and cite the eval gate in the PR ("Eval-gate: <ref>").`).toBe(want[c.id]!.prompt);
    }
  });

  it("covers Kannada, Hindi and English, each with retrieved refs", async () => {
    expect(cases.map((c) => c.language)).toEqual(["Kannada", "Hindi", "English"]);
    for (const c of cases) expect((await assemble(c)).refs_ids.length, c.id).toBeGreaterThan(0);
  });
});

describe("recorded outputs keep clearing the free lyric-metric floors", () => {
  it.each(cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const lines = singableLines(c.output);
    const norm = (l: string) => l.normalize("NFC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.length).toBeLessThanOrEqual(24);
    expect(new Set(lines.map(norm)).size / lines.length).toBeGreaterThanOrEqual(0.7);
    const letters = Array.from(c.output).filter((ch) => /\p{L}/u.test(ch));
    const own = c.language === "English" ? "latin" : c.language === "Kannada" ? "kannada" : "devanagari";
    expect(letters.filter((ch) => detectScript(ch) === own).length / letters.length).toBeGreaterThanOrEqual(0.9);
    if (c.language !== "English") expect(lines.reduce((s, l) => s + lineProsody(l).count, 0) / lines.length).toBeGreaterThan(4);
  });
});
