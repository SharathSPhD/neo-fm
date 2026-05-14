import { describe, expect, it } from "vitest";

import { parseFrontmatter, FrontmatterError } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses scalar fields and a block scalar `|`", () => {
    const text = `---
title: "Doha"
author: "Kabir"
death_year: 1518
license_basis: |
  Author died 1518.
  Indian Copyright Act 1957 §22 (life + 60) — expired.
---
body line one
body line two
`;
    const { frontmatter, body } = parseFrontmatter(text);
    expect(frontmatter.title).toBe("Doha");
    expect(frontmatter.author).toBe("Kabir");
    expect(frontmatter.death_year).toBe(1518);
    expect(frontmatter.license_basis).toContain("Author died 1518.");
    expect(frontmatter.license_basis).toContain("life + 60");
    expect(body.startsWith("body line one")).toBe(true);
  });

  it("rejects missing fence", () => {
    expect(() => parseFrontmatter("no fence here")).toThrow(FrontmatterError);
  });

  it("rejects an unclosed fence", () => {
    expect(() => parseFrontmatter("---\ntitle: x\n")).toThrow(FrontmatterError);
  });

  it("rejects malformed lines", () => {
    expect(() =>
      parseFrontmatter("---\nthis is not key value\n---\n"),
    ).toThrow(FrontmatterError);
  });

  it("preserves utf-8 (Devanagari, Kannada)", () => {
    const text = `---
title: "मैया मोरी"
note: "ಜಗದೋದ್ಧಾರ"
---
body
`;
    const { frontmatter } = parseFrontmatter(text);
    expect(frontmatter.title).toBe("मैया मोरी");
    expect(frontmatter.note).toBe("ಜಗದೋದ್ಧಾರ");
  });
});
