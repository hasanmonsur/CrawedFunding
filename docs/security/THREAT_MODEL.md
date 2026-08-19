# Threat Model Baseline

## Priority Risks

- Cross-tenant or cross-project data leakage.
- Incorrect or fraudulent accounting entries.
- Duplicate payment callback or duplicate posting.
- Privileged user self-approval.
- KYC/identity data leakage.
- Provider outage or forged callback.
- AI prompt injection, data leakage, or hallucinated recommendation.

## Baseline Controls

- Tenant/project scope checks.
- Four-eyes approval guard.
- Idempotency for money and workflow operations.
- Immutable audit events.
- No real PII in non-production.
- Regulated product features disabled by default.
