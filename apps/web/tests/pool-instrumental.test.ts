import { describe, expect, it } from "vitest";

import { parseVocalCheck } from "../lib/pool/instrumental";

describe("parseVocalCheck", () => {
  it("passes only an explicit no-vocals answer", () => {
    expect(parseVocalCheck('{"has_vocals": false, "note": "solo flute"}')).toEqual({ vocalsAbsent: true, note: "solo flute" });
  });
  it("fails closed on vocals, a missing field or junk", () => {
    expect(parseVocalCheck('{"has_vocals": true}').vocalsAbsent).toBe(false);
    expect(parseVocalCheck("{}").vocalsAbsent).toBe(false);
    expect(parseVocalCheck("not json").vocalsAbsent).toBe(false);
  });
});
