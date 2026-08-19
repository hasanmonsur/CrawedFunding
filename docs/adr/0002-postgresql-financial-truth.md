# ADR 0002: PostgreSQL as Financial Source of Truth

## Status

Accepted as baseline.

## Decision

Use PostgreSQL for authoritative transactional, accounting, audit, and workflow data.

## Consequences

- Strong consistency for postings, period locks, reconciliation, and audit.
- Use fixed-precision numeric values for money.
- Read models may exist, but financial reports must reconcile to posted ledger data.
