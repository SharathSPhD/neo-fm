import { describe, expect, it } from "vitest";

import { programQueue } from "../lib/station/program";
import type { PoolTrack } from "../lib/station/rank";

const t = (id: string, voice: PoolTrack["voice"]): PoolTrack => ({ id, language: "hi", tags: [], voice });
const ctx = { hour: 10, month: 3, day: 1, familiar: new Set<string>(), limit: 4 };

describe("voice rotation in programQueue", () => {
  it("breaks a run of the same lead gender when another voice is available", () => {
    const ranked = [t("f1", "female"), t("f2", "female"), t("f3", "female"), t("m1", "male")];
    const ids = programQueue(ranked, ctx).map((x) => x.id);
    expect(ids.slice(0, 3)).toContain("m1");
  });
  it("leaves untagged and single-voice pools in rank order", () => {
    const ranked = [t("a", null), t("b", null), t("c", null)];
    expect(programQueue(ranked, { ...ctx, limit: 3 }).map((x) => x.id)).toEqual(["a", "b", "c"]);
    const one = [t("f1", "female"), t("f2", "female"), t("f3", "female")];
    expect(programQueue(one, { ...ctx, limit: 3 })).toHaveLength(3);
  });
});
