# Phase 3 Project Development Status

## Implemented in Current Foundation

- Sponsor-linked synthetic projects.
- Scoped project listing and project detail.
- Explicit project lifecycle commands:
  - submit for due diligence
  - submit for review
  - approve
  - publish
- Due-diligence checklist completion.
- Due-diligence finding capture with remediation-required state for high findings.
- Explainable risk assessment across sponsor, market, finance, execution, legal, and governance dimensions.
- Approval gate requiring completed due diligence and risk assessment before project approval.
- Immutable offer-version creation on publication.
- Audit events for due diligence, risk assessment, project state changes, and offer publication.
- API tests for protected Phase 3 flow.

## Current Synthetic API Tokens

- `demo-token-project-manager`: assigned to `project_agro_001`.
- `demo-token-compliance`: can complete due diligence and risk assessment for `project_agro_001`.
- `demo-token-project-admin`: can approve and publish projects.

## Remaining Phase 3 Work

- Persist sponsors, projects, checklist items, findings, risk assessments, and offer versions in PostgreSQL repositories.
- Add sponsor onboarding commands and sponsor approval workflow.
- Add document module integration for evidence IDs and versioned project documents.
- Add project media, assumptions, forecast scenarios, milestones, and material-change workflow.
- Add independent reviewer controls for high-risk/high-value projects.
- Add richer OpenAPI request/response schemas once DTO package is introduced.

