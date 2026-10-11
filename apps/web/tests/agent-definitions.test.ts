import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { freeProducerParams, proProducerParams } from "../lib/agent/definitions";
import { SKILL_PCE_POEM_MD } from "../lib/agent/skill-pce-poem";

describe("agent definitions", () => {
  it("embedded skill matches managed-agents/skills/pce-poem/SKILL.md", () => {
    const disk = readFileSync(resolve(__dirname, "../../../managed-agents/skills/pce-poem/SKILL.md"), "utf8");
    expect(SKILL_PCE_POEM_MD).toBe(disk);
  });
  it("producers keep web tools off and embed safety rules", () => {
    for (const p of [freeProducerParams("s"), proProducerParams("s", "a", "b")]) {
      const ts = p.tools[0] as { configs: { name: string; enabled: boolean }[] };
      expect(ts.configs.every((c) => c.enabled === false)).toBe(true);
      expect(p.system).toMatch(/never reproduce|Safety rules/);
    }
  });
  it("pro coordinator rosters exactly the poet and polisher", () => {
    expect(proProducerParams("s", "a", "b").multiagent.agents).toEqual(["a", "b"]);
  });
});
