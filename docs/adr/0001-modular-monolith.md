# ADR 0001: Modular Monolith First

## Status

Accepted as baseline.

## Decision

Build CrowdFund360 as a modular monolith first, with domain-aligned modules, explicit contracts, transaction boundaries, and event-driven integrations.

## Consequences

- Faster MVP delivery and simpler transactional consistency.
- Module boundaries must be enforced with code review and architecture tests.
- Services can be extracted later when scale, ownership, risk, or deployment independence justify it.
