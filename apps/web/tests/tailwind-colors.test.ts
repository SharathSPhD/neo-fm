import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The theme only defines background, foreground, accent, muted and warn (plus Tailwind's default palette).
 * shadcn-style names such as bg-primary or border-border generate no CSS, so a state styled with them is silently
 * invisible (selected station chips were, on a phone). Fail fast on those names.
 */
const UNDEFINED = /(?<![\w-])(?:[a-z0-9]+:)*(?:bg|text|border|ring|divide|fill|stroke|from|to|via|outline|placeholder|decoration|caret)-(?:primary|secondary|destructive|card|popover|input|ring|border|(?:primary|secondary|accent|muted|destructive|card|popover)-foreground|muted-foreground)(?![\w-])/;

describe("tailwind colour classes", () => {
  it("only reference colours the theme defines", () => {
    const files = execSync("git ls-files 'app/*.tsx' 'components/*.tsx'", { encoding: "utf8" }).split("\n").filter(Boolean);
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        const m = UNDEFINED.exec(line);
        if (m) hits.push(`${f}:${i + 1} ${m[0]}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
