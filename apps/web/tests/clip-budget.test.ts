import { describe, expect, it } from "vitest";

import { clipBudgetFromEnv, fitToClipBudget, syllables } from "../lib/diction/budget";

describe("clip syllable budget", () => {
  it("counts akshara syllables, not code points", () => {
    expect(syllables("ಕನ್ನಡ")).toBe(3); // ka-nna-da
    expect(syllables("अंतरा")).toBe(3);
  });
  it("drops trailing whole lines past the budget but keeps minLines", () => {
    const lines = ["ಕನ್ನಡ ಕನ್ನಡ", "ಕನ್ನಡ ಕನ್ನಡ", "ಕನ್ನಡ ಕನ್ನಡ", "ಕನ್ನಡ ಕನ್ನಡ"]; // 6 syllables each
    expect(fitToClipBudget(lines, 13)).toHaveLength(3); // minLines holds
    expect(fitToClipBudget(lines, 17)).toHaveLength(3);
    expect(fitToClipBudget(lines, 100)).toHaveLength(4);
    expect(fitToClipBudget(lines, 1, 1)).toHaveLength(1);
  });
  it("is off unless the env flag is a positive number", () => {
    expect(clipBudgetFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(clipBudgetFromEnv({ CLIP_SYLLABLE_BUDGET: "0" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(clipBudgetFromEnv({ CLIP_SYLLABLE_BUDGET: "65" } as unknown as NodeJS.ProcessEnv)).toBe(65);
  });
});
