/**
 * ADR 0006 invariants enforced from inside the TypeScript test suite.
 *
 * The authoritative provenance check is `scripts/verify-lyrics-provenance.py`
 * (Python so it can be run by auditors without a Node toolchain). This file
 * mirrors that script's contract in TypeScript so the existing CI job
 * `pnpm -r test` — which already runs against every PR — refuses to let a
 * regression slip through if a contributor mutates the corpus without
 * running the Python verifier.
 *
 * What this test guarantees:
 *   - Every loadable entry across all bundled languages is
 *     license_assertion=public-domain.
 *   - There are at least 12 entries total (ADR 0006 § "Consequences"),
 *     at least 4 each for the en/hi/kn seed languages, and at least one
 *     entry per newly-shipping v1.4 language (ta/bn/te/sa) so the FS-
 *     driven allow-list in `provider.ts` has something to land on.
 *   - Every entry has a non-empty body, a recognised script, and a citation.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadCorpus } from "./corpus.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..", "..", "..");
const CORPUS = resolve(REPO_ROOT, "data", "public-lyrics");

describe("ADR 0006 — data/public-lyrics corpus invariants", () => {
  for (const lang of ["en", "hi", "kn"] as const) {
    it(`has at least 4 PD entries for language=${lang}`, () => {
      const entries = loadCorpus(lang, { rootDir: CORPUS });
      expect(entries.length).toBeGreaterThanOrEqual(4);
      for (const e of entries) {
        expect(e.license_assertion).toBe("public-domain");
        expect(e.body.length).toBeGreaterThan(0);
        expect(e.source_url).toMatch(/^https?:\/\//);
        expect(e.source_citation.length).toBeGreaterThan(0);
        expect(e.script.length).toBeGreaterThan(0);
      }
    });
  }

  // v1.4 Sprint 6: light invariants for newly-shipping languages. The
  // corpus is intentionally smaller than the seed languages — the goal is
  // "at least one verified-PD entry so the picker has something to show",
  // not "match en/hi/kn breadth". Sprints 8/9/14 keep extending these.
  for (const lang of ["ta", "bn", "te", "sa"] as const) {
    it(`has at least 1 PD entry for v1.4 language=${lang}`, () => {
      const entries = loadCorpus(lang, { rootDir: CORPUS });
      expect(entries.length).toBeGreaterThanOrEqual(1);
      for (const e of entries) {
        expect(e.license_assertion).toBe("public-domain");
        expect(e.body.length).toBeGreaterThan(0);
        expect(e.source_url).toMatch(/^https?:\/\//);
        expect(e.source_citation.length).toBeGreaterThan(0);
        expect(e.script.length).toBeGreaterThan(0);
      }
    });
  }

  it("has at least 12 total entries across en/hi/kn", () => {
    const total =
      loadCorpus("en", { rootDir: CORPUS }).length +
      loadCorpus("hi", { rootDir: CORPUS }).length +
      loadCorpus("kn", { rootDir: CORPUS }).length;
    expect(total).toBeGreaterThanOrEqual(12);
  });
});
