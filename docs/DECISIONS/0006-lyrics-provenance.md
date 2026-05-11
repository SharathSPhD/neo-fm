# ADR 0006: Lyrics provenance for the public-domain corpus

Status: Accepted

## Context

Phase 3 ships `data/public-lyrics/` as a real corpus of public-domain Indian
and English lyrics (Purandaradasa, DVG, Kabir, Tulsidas, Tagore, Blake,
Whitman, Sanskrit). "Public domain" is asserted casually but is the legal
foundation under everything `PublicLyricsLibraryProvider` serves. If we are
wrong on a single entry, an Indian or US heir / publisher / society can take
issue, and the platform's "free, real" story collapses.

This is also the most easily-poisoned data source: drop a copyrighted Hindi
film lyric in, label it `tulsidas.md`, and the system happily renders songs
under a false provenance.

## Decision

Every file under `data/public-lyrics/` is a `.md` file with required YAML
frontmatter:

```yaml
---
title: "Doha 1: Pothi Padhi Padhi"
author: "Kabir"
language: "hi"          # ISO 639-1
script: "devanagari"
death_year: 1518        # author death year; sets PD evaluation
source_text_year: 1908  # first PD-eligible printed source we cite
source_url: "https://archive.org/details/<...>"
source_citation: "Bijak of Kabir, ed. Linda Hess & Shukdev Singh (1983)"
license_assertion: "public-domain"
license_basis: |
  Author died 1518; first cited source published in India in 1908.
  Indian Copyright Act, 1957 §22: life + 60 years (Kabir is centuries past).
  US: pre-1929 print sources are public domain.
verified_by: "SharathSPhD"
verified_at: "2026-05-11"
---

<lyrics body, exactly as in source>
```

A repo-level script `scripts/verify-lyrics-provenance.py` runs in CI and
fails if:

1. Any `.md` under `data/public-lyrics/` lacks the required fields.
2. `death_year` is missing or implies non-PD status in either India or US.
3. `source_url` is unreachable from a clean fetch (the script caches; CI uses
   the cache; warns rather than fails on transient network issues).
4. The body contains lines that don't match the canonical source (allows
   normalization; flags significant divergence).

PRs adding lyrics require a human reviewer to sign off on `verified_by`.

Pratyabhijna-generated lyrics (Phase 10) get a parallel provenance field
`source_citation: "pratyabhijna://<run_id>"` and live in a separate path
(`data/pratyabhijna-lyrics/`) so they cannot be confused with PD corpus.

## Consequences

- Provenance is enforced at commit time, not in our heads.
- The corpus is auditable: any user, regulator, or society can read the
  exact frontmatter we relied on.
- Phase 3 cannot ship until at least 12 entries (4 each en/hi/kn) clear the
  verifier. That is intentional friction.
- Adding film/contemporary lyrics post-v1 requires a different provider
  (`LicensedLyricsProvider`) with a different ADR; this one only covers PD.
- A subtle risk remains: PD in India ≠ PD in US ≠ PD in EU. We are
  conservative — every entry must pass *both* Indian and US PD tests. EU is
  acceptable risk for v1 (no EU launch plan).
