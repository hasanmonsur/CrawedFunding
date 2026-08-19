# Phase 4 Investor and KYC Development Status

## Implemented in Current Foundation

- Investor self-profile lookup and update.
- Investor document metadata capture for identity, photo, address, and bank evidence.
- Bank account capture with duplicate fingerprint protection and masked API responses.
- Nominee/beneficiary capture.
- Privacy notice and risk acknowledgement consent capture.
- KYC submission gate requiring required documents, bank account, privacy consent, and risk acknowledgement.
- Compliance review queue.
- KYC review commands:
  - start review
  - request information
  - approve
  - reject
- Duplicate signal detection across identity, mobile, email, and bank account fingerprints.
- Duplicate-review blocker before KYC approval.
- Compliance hold placement.
- Audit events for investor profile, document, bank, consent, KYC, and hold actions.

## Current Synthetic API Tokens

- `demo-token-investor`: investor self-service for `investor_001`.
- `demo-token-investor-duplicate`: second synthetic investor sharing identity fingerprint.
- `demo-token-compliance`: KYC review, duplicate check, and hold management.

## Remaining Phase 4 Work

- Persist investor, KYC, document, bank, nominee, consent, and case data in PostgreSQL repositories.
- Add institutional investor and beneficial-owner hierarchy.
- Add document verification/rejection and expiry workflow.
- Add provider-backed PEP/sanctions/NID screening once legally approved.
- Add assisted/offline onboarding command path with agent, location, timestamp, and investor acknowledgement.
- Add periodic KYC refresh and expiring-document alerts.
- Add data-subject request and retention controls.

