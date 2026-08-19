# Requirements Traceability

| Requirement | Source | Phase | Current artifact |
|---|---|---:|---|
| Product boundaries disabled by default | PLAN mandatory boundary | 0 | `packages/domain-contracts/src/index.js` |
| Standard lifecycle state machines | PLAN Phase 0 | 0 | `packages/domain-contracts/src/index.js` |
| API health/readiness/context slice | PLAN Phase 1 | 1 | `apps/api/src/server.js` |
| Correlation IDs in responses | PLAN Phase 1 | 1 | `apps/api/src/server.js` |
| Tenant/project scope guard | PLAN Phase 2 | 2 | `assertTenantProjectScope` |
| Four-eyes guard | PLAN Phase 2/7 | 2 | `assertFourEyes` |
| Role-permission matrix | PLAN Phase 2 | 2 | `ROLE_PERMISSION_MATRIX` |
| Approval-limit guard | PLAN Phase 2 | 2 | `assertApprovalLimit` |
| Authenticated principal and assignments | PLAN Phase 2 | 2 | `packages/identity/src/index.js`, `/api/v1/me` |
| Protected project-scope probe | PLAN Phase 2 | 2 | `/api/v1/projects/scope-check` |
| Explicit project lifecycle commands | PLAN Phase 3 | 3 | `packages/projects/src/index.js`, `/api/v1/projects/submit-due-diligence`, `/api/v1/projects/publish` |
| Sponsor, due diligence, findings, and risk assessment | PLAN Phase 3 | 3 | `packages/projects/src/index.js`, due-diligence and risk API routes |
| Immutable published offer versions | PLAN Phase 3 | 3 | `projects.offer_versions`, `/api/v1/projects/offer-versions` |
| Investor profile self-service | PLAN Phase 4 | 4 | `packages/investors/src/index.js`, `/api/v1/investors/me` |
| KYC evidence and consent submission gates | PLAN Phase 4 | 4 | `/api/v1/investors/kyc/submit` |
| Compliance KYC review workflow | PLAN Phase 4 | 4 | `/api/v1/kyc-cases/*` |
| Duplicate detection and compliance holds | PLAN Phase 4 | 4 | `/api/v1/investors/duplicates`, `/api/v1/investors/holds` |
| Marketplace project and offer disclosure | PLAN Phase 5 | 5 | `packages/investments/src/index.js`, `/api/v1/marketplace/projects`, `/api/v1/marketplace/offers` |
| Suitability and risk acknowledgement before commitment | PLAN Phase 5 | 5 | `/api/v1/investments/suitability` |
| Commitment reservation and agreement acceptance | PLAN Phase 5 | 5 | `/api/v1/investments/commitments`, `/api/v1/investments/agreements/accept` |
| Investor portfolio commitments | PLAN Phase 5 | 5 | `/api/v1/investments/portfolio` |
| Payment reference and proof capture | PLAN Phase 6 | 6 | `packages/payments/src/index.js`, `/api/v1/payments/instructions`, `/api/v1/payments/proofs` |
| Bank transaction import and reconciliation | PLAN Phase 6 | 6 | `/api/v1/payments/bank-transactions`, `/api/v1/payments/reconciliations` |
| Cleared payment confirmation | PLAN Phase 6 | 6 | `/api/v1/payments/confirm-cleared` |
| Refund proposal and four-eyes approval | PLAN Phase 6 | 6 | `/api/v1/refunds/proposals`, `/api/v1/refunds/approve` |
| Escrow and segregated project accounts | PLAN Phase 6 | 6 | `packages/payments/src/index.js`, `/api/v1/payments/project-accounts` |
| Partial, over, under, duplicate, unmatched, returned, failed states | PLAN Phase 6 | 6 | `STATE_MACHINES.paymentInstruction`, `STATE_MACHINES.bankTransaction` |
| Signed provider callbacks with replay protection | PLAN Phase 6 | 6 | `/api/v1/payments/provider-callbacks`, `signProviderCallback` |
| Idempotent initiation, callback, settlement, receipt, and refund | PLAN Phase 6 | 6 | `once()` in `packages/payments/src/index.js` |
| Partner settlement ingestion | PLAN Phase 6 | 6 | `/api/v1/payments/settlements` |
| Exact, probable, split, aggregate, manual matching | PLAN Phase 6 | 6 | `/api/v1/payments/reconciliations/split`, `/api/v1/payments/reconciliations/aggregate` |
| Non-authoritative AI match recommendation | PLAN Phase 6/15 | 6 | `/api/v1/payments/match-candidates` |
| Reconciliation approval and lock | PLAN Phase 6 | 6 | `/api/v1/payments/reconciliations/approve`, `/api/v1/payments/reconciliations/lock` |
| Daily opening plus inflow minus outflow equals closing | PLAN Phase 6 | 6 | `/api/v1/payments/cash-controls` |
| Official receipt only after cleared payment | PLAN Phase 6 | 6 | `/api/v1/payments/receipts` |
| Refund execution separated from approval | PLAN Phase 6 | 6 | `/api/v1/refunds/execute` |
| Chart of accounts and fiscal periods | PLAN Phase 7 | 7 | `packages/accounting/src/index.js`, `/api/v1/accounting/accounts`, `/api/v1/accounting/periods` |
| Voucher workflow and double-entry posting | PLAN Phase 7 | 7 | `/api/v1/accounting/vouchers/*` |
| General ledger and trial balance reports | PLAN Phase 7 | 7 | `/api/v1/accounting/reports/general-ledger`, `/api/v1/accounting/reports/trial-balance` |
| Full voucher type catalogue | PLAN Phase 7 | 7 | `VOUCHER_TYPES`, `packages/accounting/src/index.js` |
| Accountant-approved posting matrix versioning | PLAN Phase 7 | 7 | `/api/v1/accounting/posting-matrix`, `/api/v1/accounting/posting-matrix/approve` |
| Opening balances | PLAN Phase 7 | 7 | `/api/v1/accounting/opening-balances` |
| Voucher attachments and accounting dimensions | PLAN Phase 7 | 7 | `voucher_attachments`, `accounting.journal_entries` dimension columns |
| Atomic posting and posted-entry immutability | PLAN Phase 7 | 7 | `postVoucher`, `accounting.reject_journal_mutation` trigger |
| Controlled backdated entries | PLAN Phase 7 | 7 | `/api/v1/accounting/vouchers/approve-backdate` |
| Investor, vendor, bank, receivable, payable, asset, inventory, reserve, tax, platform-fee sub-ledgers | PLAN Phase 7 | 7 | `SUB_LEDGERS`, `/api/v1/accounting/reports/sub-ledger` |
| Sub-ledger to control-account reconciliation | PLAN Phase 7 | 7 | `/api/v1/accounting/reports/sub-ledger-reconciliation` |
| Strict no-cross-project posting | PLAN Phase 7 | 7 | `cross_project_posting_denied` |
| Cash book, bank book, balance sheet, cash flow, fund utilization | PLAN Phase 7 | 7 | `/api/v1/accounting/reports/cash-book`, `/api/v1/accounting/reports/balance-sheet`, `/api/v1/accounting/reports/cash-flow` |
| Report checksums and as-of period metadata | PLAN Phase 7 | 7 | `reportChecksum`, `accounting.report_snapshots` |
| Property-based accounting invariant tests | PLAN Phase 7 | 7 | `packages/accounting/test/accounting.test.mjs` |
| Cleared payment posts through accounting workflow | PLAN Phase 6/7 | 7 | `draftReceiptForClearedPayment` |
| Voucher authorization precheck | PLAN Phase 2/7 | 2 | `/api/v1/vouchers/authorization-preview` |
| Budget revisions and approval | PLAN Phase 8 | 8 | `packages/operations/src/index.js`, `/api/v1/operations/budgets`, `/api/v1/operations/budgets/approve` |
| Procurement, expense, and asset control | PLAN Phase 8 | 8 | `/api/v1/operations/procurements`, `/api/v1/operations/expenses`, `/api/v1/operations/assets` |
| Milestone plans, evidence, and verification | PLAN Phase 9 | 9 | `/api/v1/operations/milestones`, `/api/v1/operations/milestones/verify` |
| Fund release gated on approvals and posted voucher | PLAN Phase 9 | 9 | `/api/v1/operations/fund-releases/*` |
| Project timeline, health, and delay alerts | PLAN Phase 9 | 9 | `/api/v1/operations/timeline`, `/api/v1/operations/health`, `/api/v1/operations/milestone-alerts` |
| Period-close checklist and controlled close | PLAN Phase 10 | 10 | `packages/accounting/src/index.js`, `/api/v1/accounting/periods/close-checklist`, `/api/v1/accounting/periods/close` |
| Period lock under independent approval | PLAN Phase 10 | 10 | `/api/v1/accounting/periods/lock` |
| P&L from locked accounting periods | PLAN Phase 10 | 10 | `/api/v1/accounting/reports/profit-and-loss` |
| Prior loss carry-forward treatment | PLAN Phase 10 | 10 | `/api/v1/accounting/reports/loss-carry-forward` |
| Investor allocation and project holdings | PLAN Phase 10 | 10 | `packages/investments/src/index.js`, `/api/v1/investments/allocations` |
| Distribution formula versioning | PLAN Phase 10 | 10 | `packages/distributions/src/index.js`, `/api/v1/distributions/formula-versions` |
| Distribution proposal, review, and approval | PLAN Phase 10 | 10 | `/api/v1/distributions`, `/api/v1/distributions/review`, `/api/v1/distributions/approve` |
| Entitlement pro-rata, rounding, and residual policy | PLAN Phase 10 | 10 | `calculateEntitlements`, `packages/distributions/test/distributions.test.mjs` |
| Withholding and tax records per entitlement | PLAN Phase 10 | 10 | `distributions.entitlements.withholding_amount` |
| Distribution payable gated on posted voucher | PLAN Phase 10 | 10 | `/api/v1/distributions/post-payable` |
| Payment batch, results, reissue, reconciliation | PLAN Phase 10 | 10 | `/api/v1/distributions/payment-batches`, `/api/v1/distributions/reconcile` |
| Suspended, expired, and mismatched investor holds | PLAN Phase 10 | 10 | `/api/v1/distributions/entitlements/hold`, `/api/v1/distributions/entitlements/release-hold` |
| Investor distribution statements | PLAN Phase 10 | 10 | `/api/v1/distributions/statements/me` |
| Final project settlement and archive | PLAN Phase 10 | 10 | `/api/v1/projects/settlement/close`, `/api/v1/projects/settlement/archive` |
| Fixed-precision money validation | Architecture data constraints | 7 | `assertMoney` |
| Audit event standard | PLAN Phase 2 | 2 | `buildAuditEvent` |
| Investor dashboard | PLAN Phase 11 | 11 | `packages/reporting/src/index.js`, `/api/v1/dashboards/investor` |
| Project dashboard | PLAN Phase 11 | 11 | `/api/v1/dashboards/project` |
| Administrator dashboard | PLAN Phase 11 | 11 | `/api/v1/dashboards/administrator` |
| Dashboard freshness indicators and control totals | PLAN Phase 11 | 11 | `controlTotals`, `meta.freshnessSeconds` |
| Report catalogue and controlled report runs | PLAN Phase 11 | 11 | `REPORT_CATALOGUE`, `/api/v1/reports`, `/api/v1/reports/run` |
| Versioned document storage | PLAN Phase 11 | 11 | `packages/documents/src/index.js`, `/api/v1/documents/versions` |
| OCR and metadata extraction with human verification | PLAN Phase 11 | 11 | `/api/v1/documents/extractions`, `/api/v1/documents/extractions/verify` |
| Watermarked downloads and expiring URLs | PLAN Phase 11 | 11 | `/api/v1/documents/download-grants`, `/api/v1/documents/downloads` |
| Export audit and masking | PLAN Phase 11 | 11 | `documents.access_log`, `maskRows`, `/api/v1/documents/access-log` |
| Approval for sensitive exports | PLAN Phase 11 | 11 | `/api/v1/exports/approve`, `reporting.export_requests` |
| Notification templates, preferences, delivery logs, retries | PLAN Phase 11 | 11 | `packages/notifications/src/index.js`, `/api/v1/notifications/*` |
| Multilingual notifications in Bangla and English | PLAN Phase 11 | 11 | `SUPPORTED_LOCALES`, `createDefaultTemplates` |
| AI report narrative from approved metrics with citations | PLAN Phase 11/15 | 11 | `/api/v1/reports/narrative` |
| Complaint registration, SLA, escalation, resolution, appeal | PLAN Phase 12 | 12 | `packages/cases/src/index.js`, `/api/v1/complaints/*` |
| Whistleblowing route for suspected fraud or misuse | PLAN Phase 12 | 12 | `registerComplaint` whistleblowing path, `cases.complaints` constraint |
| Risk and compliance cases from multiple signal sources | PLAN Phase 12 | 12 | `/api/v1/compliance-cases`, `CASE_SOURCES` |
| Holds on investors, payments, projects, refunds, distributions | PLAN Phase 12 | 12 | `/api/v1/governance/holds`, `governance.holds` |
| Compliance rule engine | PLAN Phase 12 | 12 | `/api/v1/compliance-rules`, `/api/v1/compliance-signals` |
| Case linking across entities | PLAN Phase 12 | 12 | `/api/v1/compliance-cases/links`, `LINKABLE_ENTITIES` |
| Audit portal with read-only access | PLAN Phase 12 | 12 | `packages/audit-portal/src/index.js`, `/api/v1/audit-portal/trail` |
| Security event visibility | PLAN Phase 12 | 12 | `/api/v1/audit-portal/security-events` |
| Independent audit evidence packages | PLAN Phase 12 | 12 | `/api/v1/audit-portal/evidence-packages`, `/api/v1/audit-portal/evidence-packages/verify` |
| Management governance and board-ready summaries | PLAN Phase 12 | 12 | `/api/v1/governance/report` |
| Regulatory reporting templates where approved | PLAN Phase 12 | 12 | `/api/v1/governance/regulatory-templates`, `REGULATORY_TEMPLATES` |
| AI complaint classification and draft response with human approval | PLAN Phase 12/15 | 12 | `/api/v1/complaints/classification`, `/api/v1/complaints/draft-response` |
