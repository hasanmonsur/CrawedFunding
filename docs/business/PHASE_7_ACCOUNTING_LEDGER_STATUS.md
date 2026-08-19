# Phase 7 Core Double-Entry Project Accounting Status

## Implemented in Current Foundation

### Chart of accounts and periods

- Chart of accounts with account type, normal balance, book type, and control-account metadata.
- Fiscal-period lifecycle with `Open`, `Closing`, `Closed`, and `Locked` states and automatic rollover.
- Opening balances recorded once per project, before any activity, with mandatory evidence.

### Voucher workflow

- Full voucher type catalogue: Opening Balance, Journal, Receipt, Payment, Contra, Purchase, Sales, Accrual, Adjustment, Depreciation, Distribution, and Reversal.
- Maker-checker-authorizer workflow with four-eyes controls at check and authorization.
- Approval-limit check before authorization.
- Voucher attachments, narration, and reference dimensions: cost center, milestone, vendor, investor, commitment, counterparty, asset, inventory item, reserve, tax, and fee codes.
- Balanced posting enforced on both the voucher and the derived journal entries.
- Atomic posting: every journal entry is built and validated before any is committed, so a rejected posting leaves nothing behind.
- Posted entries are immutable in the application and by database trigger; corrections use reversal.
- Posting date resolves to a fiscal period; entries into a closed or locked period are refused.
- Controlled backdated entries: an entry targeting an earlier open period requires an independent approver and a documented reason before it can post.

### Posting matrix

- Versioned posting matrix restricting which account types each voucher type may debit and credit, and which types require an attachment.
- Maker-checker: an accountant drafts a version and a different person approves it; approving supersedes the previous version.
- The seeded version 1 is explicitly flagged `syntheticApproval` until a finance SME signs it off.
- Every voucher records the posting matrix version it was validated against.

### Sub-ledgers and dimensions

- Investor, vendor, bank, receivable, payable, asset, inventory, reserve, tax, and platform-fee sub-ledgers.
- Control accounts declare a required dimension; a posting without it is refused.
- Bank and cash sub-ledgers are keyed by account code, so a second bank account is a second general-ledger account.
- Strict no-cross-project posting: a voucher line naming another project is refused.

### Reports

- General ledger, trial balance, and profit and loss.
- Cash book and bank book with running balances.
- Balance sheet with an asserted `assets = liabilities + equity + result` identity.
- Cash flow statement with opening, inflow, outflow, and closing balances.
- Fund utilization comparing investor funds raised against operating and capitalised deployment.
- Sub-ledger listing and a control-account reconciliation report.
- Every report carries as-of metadata (period, period status, generated-at, row count) and a deterministic SHA-256 checksum so an exported report can be proven unaltered.

### Integration

- A cleared Phase 6 payment drafts a Receipt voucher carrying the investor dimension. Accounting still requires a human to check, authorize, and post it, so payment confirmation never writes posted truth directly.

## Control Invariants Under Test

- Every posted voucher balances, and the trial balance always nets to zero.
- The balance-sheet identity holds after any sequence of postings.
- Every control account reconciles exactly to the sum of its sub-ledger balances.
- Bank book and cash flow closing balances agree with the independently tracked cash position.
- Journal entries returned to callers are copies; mutating them cannot alter the ledger.
- Nothing posted to one project ever appears under another project.
- A voucher rejected at posting leaves zero journal entries behind.

## Current Synthetic API Tokens

- `demo-token-project-manager`: creates and submits project vouchers.
- `demo-token-account-manager`: drafts posting matrix versions, records opening balances, checks vouchers, and reads all ledger reports.
- `demo-token-account-manager-two`: independent checker for vouchers the first account manager created.
- `demo-token-voucher-authorizer`: approves posting matrix versions and backdated entries, authorizes, posts, and reverses vouchers.
- `demo-token-auditor`: reads ledgers and reports but cannot create or post anything.

## API Surface

- `GET /api/v1/accounting/accounts`
- `GET /api/v1/accounting/periods`
- `GET /api/v1/accounting/posting-matrix`
- `POST /api/v1/accounting/posting-matrix`
- `POST /api/v1/accounting/posting-matrix/approve`
- `POST /api/v1/accounting/opening-balances`
- `POST /api/v1/accounting/vouchers`
- `POST /api/v1/accounting/vouchers/submit`
- `POST /api/v1/accounting/vouchers/check`
- `POST /api/v1/accounting/vouchers/authorize`
- `POST /api/v1/accounting/vouchers/approve-backdate`
- `POST /api/v1/accounting/vouchers/post`
- `POST /api/v1/accounting/vouchers/reverse`
- `GET /api/v1/accounting/reports/general-ledger`
- `GET /api/v1/accounting/reports/trial-balance`
- `GET /api/v1/accounting/reports/profit-and-loss`
- `GET /api/v1/accounting/reports/loss-carry-forward`
- `GET /api/v1/accounting/reports/sub-ledger`
- `GET /api/v1/accounting/reports/sub-ledger-reconciliation`
- `GET /api/v1/accounting/reports/cash-book`
- `GET /api/v1/accounting/reports/bank-book`
- `GET /api/v1/accounting/reports/balance-sheet`
- `GET /api/v1/accounting/reports/cash-flow`
- `GET /api/v1/accounting/reports/fund-utilization`

## Exit Gate Evidence

- Randomised posting sequences confirm every posted voucher balances and the trial balance nets to zero.
- The investor sub-ledger reconciles to control account 2000 with zero difference in every randomised scenario.
- Posting to a control account without its dimension is refused with `sub_ledger_dimension_required`.
- A voucher type may not touch an account type the approved posting matrix disallows.
- Accountant UAT of the reports is still outstanding; the seeded posting matrix is marked as a synthetic approval until a finance SME signs it off.

## Remaining Phase 7 Work

- Persist chart of accounts, posting matrix versions, fiscal periods, vouchers, voucher lines, attachments, journal entries, and report snapshots in PostgreSQL repositories.
- Obtain finance SME approval of the posting matrix and the accounting policy, replacing the synthetic seeded approval.
- Add an explicit inter-project transfer process; cross-project posting is currently refused outright with no sanctioned alternative.
- Add multi-currency accounting with FX revaluation; all ledgers are currently single-currency per project.
- Add report snapshot persistence so a checksum can be compared against a stored historical run.
- Add accountant UAT sign-off of the ledger reports before release.
