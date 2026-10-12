import { describe, expect, it } from "vitest";
import { failureCode } from "../lib/agent/process";
import { friendlyJobError } from "../components/job-progress";

describe("failureCode", () => {
  it("maps the spend-cap refusal to a user-facing code", () => {
    expect(failureCode("Lyria spend cap reached")).toBe("allowance_reached");
    expect(friendlyJobError("allowance_reached")).toMatch(/allowance/);
  });
  it("keeps a generic code for render failures and a legacy reason when nothing was recorded", () => {
    expect(failureCode("lyria 503: overloaded")).toBe("render_failed");
    expect(failureCode(null)).toBe("agent finished without audio");
    expect(friendlyJobError("agent finished without audio")).toMatch(/Something went wrong/);
  });
});
