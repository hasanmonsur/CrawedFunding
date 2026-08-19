# Phase 6 Payments, Bank References, Escrow, Refunds, and Reconciliation Status

## Implemented in Current Foundation

### Payment capture

- Unique payment instruction and reference generated from project, investor, and commitment context.
- Investor payment proof metadata submission.
- Authorized bank statement import by an account manager.
- Partner settlement file ingestion with per-batch idempotency and per-line duplicate quarantine.
- Official receipts issued only after a payment clears, with idempotent issuance.

### Escrow and segregated accounts

- Project account registry supporting `Escrow`, `Segregated Project`, and `Operating` account types.
- Exactly one primary collection account per project, enforced in code and by a partial unique index.
- Investor collections must settle into an escrow or segregated project account; operating accounts are refused.
- Funds cannot be booked to another project's account, preventing co-mingling.
- Account fingerprints are masked whenever they leave the module.

### Payment states

- Instruction lifecycle: `Issued`, `Unmatched`, `Partially Paid`, `Underpaid`, `Overpaid`, `Refund Pending`, `Matched`, `Cleared`, `Returned`, `Reversed`, `Cancelled`, `Expired`.
- Bank transaction lifecycle: `Imported`, `Unmatched`, `Matched`, `Split Matched`, `Aggregate Matched`, `Duplicate`, `Returned`, `Failed`, `Reversed`.
- Settlement amounts accumulate across transactions, so top-up payments settle an instruction over time.
- Overpayment records the excess separately and feeds the refund workflow.
- A short payment can be explicitly classified as `Underpaid` with a documented reason.
- Repeated bank references are quarantined as `Duplicate`; economically similar credits are flagged as potential duplicates.

### Provider callbacks

- Synthetic provider registry loaded through `packages/configuration`, with no live money movement enabled.
- HMAC-SHA256 signature verification over a canonical `providerId.timestamp.nonce.event` payload, compared in constant time.
- Timestamp tolerance window of 300 seconds rejects stale and future-dated callbacks.
- Nonce replay rejection independent of event deduplication.
- Provider event deduplication returns the original bank transaction instead of creating a second one.
- Failed and returned provider events are recorded without producing matchable funds.

### Matching and reconciliation

- Exact, probable, split, aggregate, and manual match types.
- Split matching applies one bank transaction across several commitments and reports the residual.
- Aggregate matching applies several bank transactions to one commitment.
- Manual, split, and aggregate matches accept a reference override only with a documented reason.
- Non-authoritative match candidate scoring with per-signal explanations, explicitly flagged `authoritative: false` and `decisionRequiresHuman: true`.
- Reconciliation exceptions for reference, currency, availability, and already-settled conditions.
- Maker-checker: an account manager matches, an independent voucher authorizer approves, then locks.
- A locked reconciliation is immutable and cannot be reversed.
- Reversal restores instruction settlement, releases the transaction allocation, and returns the transaction.

### Refunds and cash control

- Refund proposal, four-eyes approval, and separated execution with idempotent execution.
- Daily cash control enforcing `opening + inflow - outflow = closing`, in code and as a database check constraint.
- One cash control per project per date.

### Idempotency

- Payment instruction creation, bank import, partner settlement import, receipt issuance, and refund execution are all idempotency-key protected.
- Replayed keys return the original record and never create a second one.

## Control Invariants Under Test

- Applied reconciliation amounts always equal the instruction's settled amount.
- A bank transaction is never allocated beyond its own amount.
- Instruction status is a pure function of settled versus expected amount.
- A replayed provider event produces exactly one bank transaction.
- A replayed nonce is always rejected, even for a new event.
- Clearing requires an approved reconciliation covering the full expected amount.

## Current Synthetic API Tokens

- `demo-token-investor-approved`: creates payment instructions and submits payment proof.
- `demo-token-account-manager`: imports bank statements and settlement files, matches payments, classifies short payments, issues receipts, proposes refunds, and records cash controls.
- `demo-token-voucher-authorizer`: approves, locks, rejects, and reverses reconciliations, and approves and executes refunds.
- `demo-token-project-admin`: registers escrow and segregated project accounts.

## API Surface

- `POST /api/v1/payments/instructions`
- `POST /api/v1/payments/proofs`
- `GET /api/v1/payments/project-accounts`
- `POST /api/v1/payments/project-accounts`
- `POST /api/v1/payments/bank-transactions`
- `GET /api/v1/payments/bank-transactions`
- `POST /api/v1/payments/settlements`
- `GET /api/v1/payments/providers`
- `POST /api/v1/payments/provider-callbacks`
- `GET /api/v1/payments/match-candidates`
- `POST /api/v1/payments/reconciliations`
- `GET /api/v1/payments/reconciliations`
- `POST /api/v1/payments/reconciliations/split`
- `POST /api/v1/payments/reconciliations/aggregate`
- `POST /api/v1/payments/reconciliations/approve`
- `POST /api/v1/payments/reconciliations/reject`
- `POST /api/v1/payments/reconciliations/lock`
- `POST /api/v1/payments/reconciliations/reverse`
- `POST /api/v1/payments/instructions/classify-short`
- `GET /api/v1/payments/settlement-status`
- `POST /api/v1/payments/confirm-cleared`
- `POST /api/v1/payments/receipts`
- `GET /api/v1/payments/exceptions`
- `POST /api/v1/payments/cash-controls`
- `GET /api/v1/payments/cash-controls`
- `POST /api/v1/refunds/proposals`
- `POST /api/v1/refunds/approve`
- `POST /api/v1/refunds/execute`

## Exit Gate Evidence

- A replayed provider callback nonce is rejected with `callback_nonce_replayed`, and a repeated provider event returns `deduplicated: true` against the original bank transaction, so no duplicate funds or ledger entries can be created.
- Applied reconciliation amounts equal instruction settled amounts and no transaction is over-allocated, across randomised payment sequences.
- Clearing is refused with `reconciliation_approval_required` until an independent approver signs off the full expected amount.
- Refund approval is refused for the proposer, and execution is refused for an unapproved refund.

## Remaining Phase 6 Work

- Persist payments, accounts, transactions, reconciliations, refunds, callbacks, receipts, and idempotency records through PostgreSQL repositories.
- Add live gateway, card, and BanglaQR adapters once legally approved; the current registry is synthetic and disabled for money movement.
- Add statement file format parsers (MT940 and CSV dialects) ahead of the generic settlement line ingestion.
- Post cleared payments into Phase 7 accounting automatically instead of through a separately created voucher.
- Add reconciliation ageing, escalation queues, and operator dashboards in Phase 11.
