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
 *   - Every loadable entry across en/hi/kn is license_assertion=public-domain.
 *   - There are at least 12 entries total and 4 per language (ADR 0006 §
 *     "Consequences").
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

  it("has at least 12 total entries across en/hi/kn", () => {
    const total =
      loadCorpus("en", { rootDir: CORPUS }).length +
      loadCorpus("hi", { rootDir: CORPUS }).length +
      loadCorpus("kn", { rootDir: CORPUS }).length;
    expect(total).toBeGreaterThanOrEqual(12);
  });
});
