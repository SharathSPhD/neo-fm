# Sprint N — ralph evidence template

Status: PASS / FAIL
Date: YYYY-MM-DD
Commit: `<sha>`

## What shipped

- bullet 1
- bullet 2

## Files touched

```
path/to/file.ts        added
path/to/other.py       modified
```

## Tests added

- `path/to/spec.test.ts` (N cases)
- `path/to/test_module.py` (N cases)

## Promise gate

| check | result | evidence |
| --- | --- | --- |
| `pnpm lint` | PASS / FAIL | output below |
| `pnpm typecheck` | PASS / FAIL | output below |
| `pnpm test` | PASS / FAIL | N/N tests green |
| `pytest` | PASS / FAIL | N/N tests green |
| sprint-specific (e2e / smoke / DGX run / training run) | PASS / FAIL | output below |
| Supabase advisors clean | PASS / FAIL | `get_advisors` output |

```
pnpm lint
$ ...

pnpm typecheck
$ ...

pnpm test
$ ...

pytest
$ ...
```

## Notable decisions

- decision 1, with link to ADR if relevant
