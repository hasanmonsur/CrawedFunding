# Phase 8 Operations, Budget, Procurement, Expense, and Asset Status

## Implemented in Current Foundation

- Project budget revision creation.
- Independent project-admin budget approval.
- Approved-budget supersession by budget code.
- Budget availability checks before procurement and expense submission.
- Procurement request creation and independent approval.
- Expense claim submission, procurement linkage, and account-manager approval.
- Expense amount control against approved procurement amount.
- Asset registration from approved operational expense.
- Duplicate asset-tag prevention within organization.
- Budget variance report with budget, committed, actual, and available amounts.
- Audit events for budget, procurement, expense, and asset commands.

## Current Synthetic API Tokens

- `demo-token-project-manager`: creates budgets, procurement requests, expense claims, and assets.
- `demo-token-project-admin`: approves budget revisions and procurement requests.
- `demo-token-account-manager`: approves expense claims.

## API Surface

- `GET /api/v1/operations/budgets`
- `POST /api/v1/operations/budgets`
- `POST /api/v1/operations/budgets/approve`
- `GET /api/v1/operations/budget-variance`
- `POST /api/v1/operations/procurements`
- `POST /api/v1/operations/procurements/approve`
- `POST /api/v1/operations/expenses`
- `POST /api/v1/operations/expenses/approve`
- `POST /api/v1/operations/assets`

## Remaining Phase 8 Work

- Replace in-memory stores with PostgreSQL repositories.
- Add purchase order, goods receipt, vendor master, and invoice matching.
- Add budget transfer and project cash-flow forecasting.
- Add asset depreciation, maintenance, disposal, and physical-verification workflows.
- Integrate approved expense claims into accounting voucher creation.
