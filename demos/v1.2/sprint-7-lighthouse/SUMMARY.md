# Sprint 7.5 — Lighthouse

**Target**: https://neo-fm-web.vercel.app
**Preset**: desktop, headless Chrome (Playwright bundle)
**Date**: 2026-05-16T17:49:13.084Z
**Total runtime**: 51.6s

Authenticated pages (e.g. `/library`) are excluded — see comment in
`infra/scripts/run-lighthouse.mjs`. Public-surface coverage is what
gates the Phase 6 promise.

## Scores

| Page | Perf | A11y | BP | SEO | LCP (ms) | TBT (ms) | CLS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `landing` | 100 | 96 | 100 | 100 | 424 | 0 | 0 |
| `discover` | 100 | 95 | 100 | 100 | 431 | 0 | 0 |
| `pricing` | 100 | 96 | 100 | 100 | 438 | 0 | 0 |
| `sign-in` | 100 | 100 | 100 | 100 | 263 | 0 | 0 |

## Raw reports

- [`landing.json`](./landing.json)
- [`discover.json`](./discover.json)
- [`pricing.json`](./pricing.json)
- [`sign-in.json`](./sign-in.json)

## Re-run

```bash
node infra/scripts/run-lighthouse.mjs
```
