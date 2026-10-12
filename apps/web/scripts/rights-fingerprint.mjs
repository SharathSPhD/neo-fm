#!/usr/bin/env node
/**
 * Add a protected song to the verbatim-overlap reference list WITHOUT storing its lyrics:
 *   pbpaste | node scripts/rights-fingerprint.mjs <id> "<title>" >> /tmp/entry.json
 * Prints one JSON entry (hashed 6-word shingles) to merge into lib/rights/reference-fingerprints.json.
 * The normalisation below duplicates lib/rights/normalise.ts on purpose (plain node, no build step); tests/rights.test.ts fails if they drift.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const N = 6;

export function normaliseText(raw) {
  return raw.normalize("NFKC").toLowerCase().normalize("NFD").replace(/([a-z])\p{M}+/gu, "$1").replace(/़|়/g, "").normalize("NFC")
    .replace(/[​-‏⁠﻿]/g, "").replace(/[.\-_,;:!?'"“”‘’()[\]{}/\\|*•·।॥]+/g, " ").replace(/\s+/g, " ").trim();
}
export function shingles(text) {
  const ws = normaliseText(text).split(" ").filter(Boolean); const out = new Set();
  for (let i = 0; i + N <= ws.length; i++) out.add(createHash("sha256").update(ws.slice(i, i + N).join(" ")).digest("hex").slice(0, 16));
  return [...out];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [id, title] = process.argv.slice(2);
  if (!id || !title) { console.error('usage: rights-fingerprint.mjs <id> "<title>" < lyrics.txt'); process.exit(1); }
  console.log(JSON.stringify({ id, title, n: N, shingles: shingles(readFileSync(0, "utf8")) }, null, 2));
}
