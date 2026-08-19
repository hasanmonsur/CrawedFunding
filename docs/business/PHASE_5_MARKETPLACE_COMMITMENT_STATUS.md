# Phase 5 Marketplace and Commitment Development Status

## Implemented in Current Foundation

- Published-project marketplace listing.
- Published offer disclosure with accepted offer-version snapshot.
- Watchlist capture for investor interest.
- Suitability answers and risk acknowledgement before commitment.
- KYC-approved investor eligibility gate.
- Investor hold gate blocking commitments.
- Project minimum/maximum investment validation.
- Commitment reservation with expiry.
- Accepted offer project-version capture for immutability.
- Agreement acceptance moving commitment to Awaiting Payment.
- Investor portfolio list for current commitments.
- Audit events for watchlist, suitability, commitment reservation, and agreement acceptance.

## Current Synthetic API Tokens

- `demo-token-investor-approved`: approved investor eligible for Phase 5 commitment tests.
- `demo-token-investor`: draft KYC investor, blocked from commitments.
- `demo-token-project-admin`: can publish the synthetic approved project to create an offer version.

## Remaining Phase 5 Work

- Persist marketplace, suitability, watchlist, commitment, agreement, and portfolio records in PostgreSQL repositories.
- Add richer project filters, sorting, comparison, FAQs, project updates, and fee/net amount calculation.
- Add offer material-change re-consent.
- Add investor class, concentration, and related-party limit checks.
- Add agreement PDF/document generation and e-signature/evidence integration.
- Add cooling-off/cancellation/expiry job handling.

