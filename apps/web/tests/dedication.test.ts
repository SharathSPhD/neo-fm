import { describe, expect, it } from "vitest";

import {
  DedicationBodySchema,
  cleanDedicationText,
  whatsappShareUrl,
} from "@/lib/share/dedication";

describe("dedication body", () => {
  it("trims, strips bidi/control chars, nulls empties", () => {
    const r = DedicationBodySchema.parse({ to: "  Amma‮ ", message: "Happy​ birthday\u0007!" });
    expect(r).toEqual({ to: "Amma", message: "Happy birthday!" });
    expect(DedicationBodySchema.parse({ to: " ", message: "" })).toEqual({ to: null, message: null });
  });

  it("requires a recipient when a message is set", () => {
    expect(DedicationBodySchema.safeParse({ to: "", message: "hi" }).success).toBe(false);
  });

  it("counts code points, not UTF-16 units, for Indic text", () => {
    const ok = "ಅ".repeat(280);
    expect(DedicationBodySchema.safeParse({ to: "ಅಮ್ಮ", message: ok }).success).toBe(true);
    expect(DedicationBodySchema.safeParse({ to: "x", message: ok + "ಅ" }).success).toBe(false);
  });

  it("cleanDedicationText collapses spaces", () => {
    expect(cleanDedicationText("a   b\t c")).toBe("a b c");
  });
});

describe("whatsappShareUrl", () => {
  it("encodes the lead line and link", () => {
    const u = whatsappShareUrl({ to: "Amma", title: "Raag", url: "https://x.app/s/abc" });
    expect(u.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(u.split("text=")[1]!)).toContain("A song for Amma");
    expect(decodeURIComponent(u.split("text=")[1]!)).toContain("https://x.app/s/abc");
  });
});
