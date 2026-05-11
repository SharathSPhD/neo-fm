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

| #    | Title                                                                                          | Status   |
| ---- | ---------------------------------------------------------------------------------------------- | -------- |
| 0001 | [Queue: pgmq over pg-boss](0001-queue.md)                                                       | Accepted |
| 0002 | [License: Apache-2.0](0002-license.md)                                                          | Accepted |
| 0003 | [Internal API authenticated by shared-secret HMAC](0003-internal-api-hmac.md)                   | Accepted |
| 0004 | [Dedicated `neo_fm_worker` Postgres role](0004-worker-db-role.md)                               | Accepted |
| 0005 | [Audio storage retention and tier byte caps](0005-storage-retention.md)                         | Accepted |
| 0006 | [Lyrics provenance for the public-domain corpus](0006-lyrics-provenance.md)                     | Accepted |
| 0007 | [Observability lands incrementally, not all in Phase 11](0007-observability-from-phase-1.md)    | Accepted |
| 0008 | [pgmq job leases, retries, and dead-letter handling](0008-pgmq-leases.md)                       | Accepted |

## How TRIZ contradictions get recorded here

TRIZ resolutions from [SPEC.md](../SPEC.md) §7 each get an ADR when they require non-obvious tradeoffs in code. The ADR cites the contradiction (C1–C5) and the chosen inventive principle.
