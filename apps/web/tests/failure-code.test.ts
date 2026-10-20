import { describe, expect, it } from "vitest";
import { failureCode } from "../lib/agent/process";
import { friendlyJobError } from "../components/job-progress";
import { translate } from "../lib/i18n/ui-strings";

describe("failureCode", () => {
  it("maps the spend-cap refusal to a user-facing code", () => {
    expect(failureCode("Lyria spend cap reached")).toBe("allowance_reached");
    expect(friendlyJobError("allowance_reached")).toMatch(/allowance/);
  });
  it("maps an exhausted provider balance (402) to a pause message in every shipped language", () => {
    expect(failureCode('lyria 402: {"error":"prepayment credits depleted"}')).toBe("creation_paused");
    expect(friendlyJobError("creation_paused")).toMatch(/paused/);
    for (const lang of ["hi", "kn", "te", "ta", "mr"] as const) {
      const t = (k: Parameters<typeof translate>[1], v?: Parameters<typeof translate>[2]) => translate(lang, k, v);
      expect(friendlyJobError("creation_paused", t)).not.toBe(friendlyJobError("creation_paused"));
    }
  });
  it("keeps a generic code for render failures and a legacy reason when nothing was recorded", () => {
    expect(failureCode("lyria 503: overloaded")).toBe("render_failed");
    expect(failureCode(null)).toBe("agent finished without audio");
    expect(friendlyJobError("agent finished without audio")).toMatch(/Something went wrong/);
  });
});
