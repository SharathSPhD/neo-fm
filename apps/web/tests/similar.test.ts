import { describe, expect, it } from "vitest";

import { forYouReason, rankSimilar } from "@/lib/personalization/similar";
import type { TasteProfile } from "@/lib/personalization/taste";

const cur = { public_id: "a", language: "kn", style: "kannada-folk" };
const c = (id: string, language: string, style: string) => ({
  public_id: id,
  title: id,
  language,
  style,
});

describe("rankSimilar", () => {
  it("excludes the current song, dedupes, drops unrelated", () => {
    const out = rankSimilar(cur, [
      c("a", "kn", "kannada-folk"),
      c("b", "kn", "kannada-folk"),
      c("b", "kn", "kannada-folk"),
      c("z", "en", "western"),
    ]);
    expect(out.map((p) => p.public_id)).toEqual(["b"]);
  });

  it("ranks style+language above partial matches", () => {
    const out = rankSimilar(cur, [
      c("lang", "kn", "western"),
      c("both", "kn", "kannada-folk"),
      c("style", "hi", "kannada-folk"),
    ]);
    expect(out.map((p) => p.public_id)).toEqual(["both", "style", "lang"]);
  });

  it("taste breaks ties but never beats similarity", () => {
    const profile: TasteProfile = {
      weights: { language: { hi: 50 }, style: { western: 50 } },
      nSignals: 10,
    };
    const out = rankSimilar(
      cur,
      [c("lang", "kn", "western"), c("style", "hi", "kannada-folk"), c("both", "kn", "kannada-folk")],
      profile,
    );
    expect(out[0]!.public_id).toBe("both");
    expect(out[1]!.public_id).toBe("style"); // 3 + cap 1 beats 2 + cap 1
  });
});

describe("forYouReason", () => {
  it("names the strongest weight, or nothing", () => {
    const p: TasteProfile = {
      weights: { language: { kn: 1 }, style: { carnatic: 3 } },
      nSignals: 5,
    };
    expect(forYouReason(p, "kn", "carnatic")).toBe("Because you like Carnatic");
    expect(forYouReason(p, "kn", "western")).toBe("Because you like Kannada");
    expect(forYouReason(p, "en", "western")).toBe("");
  });
});
