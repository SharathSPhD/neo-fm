import { describe, expect, it } from "vitest";
import { validatePolishTemplate } from "../lib/lyrics/polish";
import { POLISH_VARIANTS, polishVariant, CONTROL_TEMPLATE } from "../lib/lyrics/prosody-experiments";

describe("prosody experiment variants", () => {
  it("every variant passes the same guard the self-improve loop enforces", () => {
    for (const v of POLISH_VARIANTS) expect(validatePolishTemplate(v.template), v.id).toBeNull();
  });
  it("ids are unique and differ from the control", () => {
    expect(new Set(POLISH_VARIANTS.map((v) => v.id)).size).toBe(POLISH_VARIANTS.length);
    for (const v of POLISH_VARIANTS) expect(v.template).not.toBe(CONTROL_TEMPLATE);
  });
  it("lookup is exact and null for unknown ids", () => {
    expect(polishVariant("anchor-pair")?.id).toBe("anchor-pair");
    expect(polishVariant("nope")).toBeNull();
    expect(polishVariant(null)).toBeNull();
  });
});
