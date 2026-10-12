import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { freeProducerParams, proProducerParams } from "../lib/agent/definitions";
import { SKILL_FILES, SKILL_PCE_POEM_MD } from "../lib/agent/skill-pce-poem";

describe("agent definitions", () => {
  it("embedded skill matches managed-agents/skills/pce-poem/SKILL.md", () => {
    const disk = readFileSync(resolve(__dirname, "../../../managed-agents/skills/pce-poem/SKILL.md"), "utf8");
    expect(SKILL_PCE_POEM_MD).toBe(disk);
  });
  it("embedded engine files match managed-agents/pce-engine", () => {
    for (const [name, text] of Object.entries(SKILL_FILES)) {
      if (name === "pce-poem/SKILL.md") continue;
      const disk = readFileSync(resolve(__dirname, "../../../managed-agents/pce-engine", name.replace(/^pce-poem\//, "")), "utf8");
      expect(text).toBe(disk);
    }
    expect(Object.keys(SKILL_FILES)).toContain("pce-poem/run_cascade.py");
  });
  it("free keeps web tools off, pro may research; both embed safety rules", () => {
    const free = freeProducerParams("s").tools[0] as { configs: { name: string; enabled: boolean }[] };
    expect(free.configs.every((c) => c.enabled === false)).toBe(true);
    const pro = proProducerParams("s", "a", "b");
    const proTools = pro.tools[0] as { configs: { name: string; enabled: boolean }[] };
    expect(proTools.configs.map((c) => c.name).sort()).toEqual(["web_fetch", "web_search"]);
    expect(pro.system).toMatch(/never copy or paraphrase lyrics/);
    for (const p of [freeProducerParams("s"), pro]) expect(p.system).toMatch(/never reproduce|Safety rules/);
  });
  it("pro coordinator rosters exactly the poet and polisher", () => {
    expect(proProducerParams("s", "a", "b").multiagent.agents).toEqual(["a", "b"]);
  });
});
