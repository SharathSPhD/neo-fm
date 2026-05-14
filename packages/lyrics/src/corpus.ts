/**
 * Loads `data/public-lyrics/<language>/*.md` into typed `LyricsEntry` objects.
 *
 * This is intentionally a thin wrapper around the filesystem. The hard work
 * (provenance enforcement, PD-in-India / PD-in-US gating, body-vs-source
 * checks) lives in `scripts/verify-lyrics-provenance.py` which runs in CI.
 * If a non-PD entry gets here at runtime it is a bug in the verifier, not
 * a runtime concern of this package.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Language, Script } from "@neo-fm/song-doc";

import { parseFrontmatter } from "./frontmatter.js";

export interface LyricsEntry {
  /** Stable id derived from the on-disk path (e.g. `hi/kabir-pothi`). */
  id: string;
  title: string;
  author: string;
  language: Language;
  script: Script;
  body: string;
  source_url: string;
  source_citation: string;
  license_assertion: "public-domain";
}

export interface LoadCorpusOptions {
  /**
   * Absolute path to the corpus root (`data/public-lyrics/`). Defaults to the
   * repo-relative location, which works in monorepo development. Override in
   * tests or in deployments where the corpus is mounted elsewhere.
   */
  rootDir?: string;
}

function defaultRootDir(): string {
  // packages/lyrics/dist/corpus.js -> .../packages/lyrics -> .../packages -> repo root
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "..", "data", "public-lyrics");
}

function readEntry(filePath: string, language: Language): LyricsEntry {
  const text = readFileSync(filePath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(text);

  const requiredString = (key: string): string => {
    const v = frontmatter[key];
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(`${filePath}: missing required string field ${key}`);
    }
    return v;
  };

  if (frontmatter.language !== language) {
    throw new Error(
      `${filePath}: frontmatter language=${String(
        frontmatter.language,
      )} disagrees with directory language=${language}`,
    );
  }
  if (frontmatter.license_assertion !== "public-domain") {
    throw new Error(
      `${filePath}: license_assertion=${String(
        frontmatter.license_assertion,
      )} is not "public-domain"; refusing to load`,
    );
  }

  const script = requiredString("script") as Script;

  const fileBase = filePath.split("/").pop()?.replace(/\.md$/, "") ?? "unknown";
  return {
    id: `${language}/${fileBase}`,
    title: requiredString("title"),
    author: requiredString("author"),
    language,
    script,
    body: body.trim(),
    source_url: requiredString("source_url"),
    source_citation: requiredString("source_citation"),
    license_assertion: "public-domain",
  };
}

/**
 * Loads every `.md` under `<root>/<lang>/` for the given language.
 *
 * Order is deterministic (sorted by filename) so the provider's "pick the
 * first matching entry" fallback is reproducible across machines, CI runs,
 * and the demo build.
 */
export function loadCorpus(
  language: Language,
  options: LoadCorpusOptions = {},
): LyricsEntry[] {
  const root = options.rootDir ?? defaultRootDir();
  const dir = join(root, language);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `public-lyrics corpus missing language directory: ${dir} ` +
          `(did you check out data/public-lyrics/?)`,
      );
    }
    throw err;
  }

  const entries: LyricsEntry[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    const filePath = join(dir, name);
    if (!statSync(filePath).isFile()) continue;
    entries.push(readEntry(filePath, language));
  }

  if (entries.length === 0) {
    throw new Error(
      `public-lyrics corpus has no entries for language=${language} in ${dir}`,
    );
  }
  return entries;
}
