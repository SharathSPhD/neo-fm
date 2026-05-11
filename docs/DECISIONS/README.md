# Architecture Decision Records (ADRs)

Nygard-style ADRs. Each is small, focused, and immutable once accepted. Supersede by writing a new ADR that references the old one.

## Template

```
# ADR NNNN: <short title>

Status: Proposed | Accepted | Superseded by ADR-XXXX

## Context

What forces are at play (technical, political, social, project-local)?

## Decision

The change we are making.

## Consequences

What becomes easier or harder. Tradeoffs accepted.
```

## Index

| #    | Title                          | Status   |
| ---- | ------------------------------ | -------- |
| 0001 | [Queue: pgmq over pg-boss](0001-queue.md)       | Accepted |
| 0002 | [License: Apache-2.0](0002-license.md)          | Accepted |

## How TRIZ contradictions get recorded here

TRIZ resolutions from [SPEC.md](../SPEC.md) §7 each get an ADR when they require non-obvious tradeoffs in code. The ADR cites the contradiction (C1–C5) and the chosen inventive principle.
