# Phase 10 Period Close, P&L, Loss Treatment, and Investor Distribution Status

## Implemented in Current Foundation

- Fiscal-period lifecycle with `Open`, `Closing`, `Closed`, and `Locked` states.
- Period-close checklist with manual evidence-backed items and an automated unposted-voucher check.
- Adjusting entries remain postable while a period is `Closing`, and are blocked once it is `Closed` or `Locked`.
- Period close computes profit and loss from posted journal entries stamped with the period.
- Prior-period loss carry-forward applied automatically to the next profitable period.
- Period lock under an independent approver, with the locked result frozen as the distribution input.
- Automatic rollover: closing a period opens the next sequential period for ongoing postings.
- Distribution formula versioning with immutable published versions and single-active-version enforcement.
- Distribution proposal gated on a locked period, a published formula, and positive distributable profit.
- Exact integer pro-rata entitlement calculation on capital or capital-and-holding-period bases.
- Configurable rounding residual handling: `largest-remainder` or `retain-reserve`.
- Reserve rate and withholding-tax rate applied per entitlement with exact gross/withholding/net decomposition.
- Investor eligibility screening for holding period, allocation date, and currency match.
- Investor holds for unapproved KYC, compliance holds, and missing payout accounts, with controlled release.
- Approval chain: create, independent review, independent approval under a monetary approval limit.
- Distribution payable posting gated on a matching posted accounting voucher.
- Payment batch export, per-entitlement payment results, reissue of failed and returned payments.
- Reconciliation blocked while any payment is unsettled; completion blocked while any entitlement is unresolved.
- Investor distribution statements with gross, withholding, net, and paid totals.
- Project settlement and archive with lifetime distribution totals and holding settlement.
- Audit events for every period-close, formula, distribution, entitlement, and settlement command.
- Property tests covering value conservation, rounding, minor-unit alignment, eligibility, holds, and determinism.

## Control Invariants Under Test

- `sum(entitlement gross) + residual == distributable amount` for every calculation.
- `gross == withholding + net` for every entitlement.
- All entitlement amounts are non-negative and aligned to the currency minor unit.
- Excluded entitlements receive no funds and always carry an exclusion reason.
- Held entitlements retain their entitlement but never enter a payment batch.
- Identical inputs always produce identical entitlement allocations.

## Current Synthetic API Tokens

- `demo-token-account-manager`: starts period close, completes checklist items, closes periods, drafts formulas, creates distribution proposals, calculates, and reconciles.
- `demo-token-account-manager-two`: independently reviews distributions.
- `demo-token-voucher-authorizer`: locks periods, posts distribution payables, submits payment batches, and records payment results.
- `demo-token-project-admin`: publishes formula versions, approves distributions, completes distributions, and settles projects.
- `demo-token-compliance`: places and releases entitlement holds.
- `demo-token-investor-approved`: reads its own distribution statement.
- `demo-token-super-admin`: synthetic organization-wide operator used for cross-project accounting entries in tests.

## API Surface

- `GET /api/v1/accounting/periods/close-checklist`
- `POST /api/v1/accounting/periods/start-close`
- `POST /api/v1/accounting/periods/checklist-items`
- `POST /api/v1/accounting/periods/reopen`
- `POST /api/v1/accounting/periods/close`
- `POST /api/v1/accounting/periods/lock`
- `GET /api/v1/accounting/reports/profit-and-loss`
- `GET /api/v1/accounting/reports/loss-carry-forward`
- `POST /api/v1/investments/allocations`
- `POST /api/v1/investments/activations`
- `GET /api/v1/distributions/formula-versions`
- `POST /api/v1/distributions/formula-versions`
- `POST /api/v1/distributions/formula-versions/publish`
- `GET /api/v1/distributions`
- `POST /api/v1/distributions`
- `POST /api/v1/distributions/calculate`
- `POST /api/v1/distributions/review`
- `POST /api/v1/distributions/approve`
- `POST /api/v1/distributions/post-payable`
- `POST /api/v1/distributions/payment-batches`
- `POST /api/v1/distributions/payment-results`
- `POST /api/v1/distributions/entitlements/reissue`
- `POST /api/v1/distributions/entitlements/hold`
- `POST /api/v1/distributions/entitlements/release-hold`
- `POST /api/v1/distributions/entitlements/cancel`
- `POST /api/v1/distributions/reconcile`
- `POST /api/v1/distributions/complete`
- `GET /api/v1/distributions/statements/me`
- `POST /api/v1/projects/settlement/close`
- `POST /api/v1/projects/settlement/archive`

## Exit Gate Evidence

- A distribution proposal is rejected with `period_result_unavailable` before close and `period_not_locked` before lock.
- A distribution cannot be approved without an independent reviewer, and cannot be approved by its creator or reviewer.
- Distribution payable posting is rejected with `payable_voucher_mismatch` unless a posted voucher matches the approved gross total and currency.
- Reconciliation is rejected with `distribution_payments_outstanding` while any payment is unsettled.

## Remaining Phase 10 Work

- Persist periods, results, formula versions, distributions, entitlements, batches, and settlements through repositories.
- Add depreciation schedules and automated accrual generation instead of manually posted adjusting vouchers.
- Add jurisdiction-specific tax and withholding certificate generation.
- Add provider-native payout submission and return-file ingestion alongside batch export.
- Add distribution statement documents and investor notification delivery.
- Add multi-currency distributions and FX policy handling.
