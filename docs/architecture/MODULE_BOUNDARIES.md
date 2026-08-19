# Module Boundaries

## Dependency Direction

Identity and Organization is foundational. Project, Investor, Investment, Payment, Accounting, Distribution, Operations, Reporting, Compliance, Documents, Notifications, and AI modules must communicate through application services, contracts, or events.

## Rules

- Modules do not query another module's tables directly from application code.
- Accounting owns posted financial truth.
- Payment confirmation does not directly mutate investor balances without allocation/accounting workflow.
- Dashboards read from authoritative ledger data or read models with freshness metadata.
- AI modules cannot execute controlled business actions.

## Current Executable Boundary Guards

- `assertTenantProjectScope` blocks cross-organization and cross-project access.
- `assertFourEyes` blocks self-approval for controlled actions.
- `assertPermission` checks role permissions and assignment scope.
- `assertApprovalLimit` checks monetary authority before controlled approval.

## Distribution Module Boundary

- Accounting owns fiscal periods, period results, and loss carry-forward. Distribution reads them through `getPeriodResult` and `getProjectLossCarryForward` and never recomputes profit itself.
- Distribution never posts accounting entries. It verifies an already-posted voucher through `getPostedVoucherSummary` before recognising a payable.
- Distribution reads investor payout eligibility through `getInvestorSettlementProfile`, which exposes KYC status, hold status, and a masked payout reference only. No investor PII crosses the boundary.
- Distribution reads capital positions through `listProjectHoldings` and requests settlement through `settleProjectHoldings`. It never mutates commitment records directly.
- Entitlement arithmetic runs on integer minor units so allocation, rounding, residual, and withholding are exact and reproducible.

## Payment Module Boundary

- Payment provider secrets and callback tolerance come from `packages/configuration`; the payment module never reads infrastructure environment variables directly.
- Provider callbacks authenticate by HMAC signature, not by a user session. They run under a synthetic `provider:<id>` actor and cannot perform any command a user role could not.
- Payment never writes accounting entries. Cleared payments transition the commitment through `investmentService`; posting remains an accounting command.
- Investor identity never crosses into payment records. Bank and project account fingerprints are masked whenever they leave the module.
- Escrow and segregated project accounts are the only accounts that may receive investor collections, and an account can only receive funds for the project it belongs to.
- Settlement arithmetic runs on integer minor units so partial, over, split, and aggregate matching remain exact and reproducible.

## Accounting Module Boundary

- Accounting is the only module that writes journal entries. Every other module either requests a draft voucher or verifies an already-posted one.
- A cleared payment drafts a Receipt voucher through `draftReceiptForClearedPayment`. It never posts. The maker-checker-authorizer workflow still applies, so payment confirmation cannot create posted truth on its own.
- Control accounts declare their sub-ledger and, where the sub-ledger is party-scoped, the dimension every posting must carry. Sub-ledger balances are derived from journal entries, never maintained separately, so they cannot drift from the control account.
- Voucher lines may not name another project. Cross-project movement requires an explicit inter-project process, which this foundation refuses rather than silently permits.
- The posting matrix is the accountant-owned contract between business modules and the ledger. Modules choose a voucher type; the matrix decides which account types that type may touch.
- Ledger reads require the ledger-read permission. The auditor role holds it with no posting rights at all.

## Reporting, Documents, and Notification Boundaries

- Reporting owns no data. Every figure is read through to the module that owns it, so a dashboard tile and the report behind it cannot drift apart. There is no cached read model to invalidate.
- Reporting calls owning services with the caller's own principal. A tile the caller may not see is marked restricted with its reason rather than being silently omitted or filled with a stale value.
- Dashboards publish control totals taken directly from the ledger. That is the reconciliation contract: a dashboard is wrong if its control totals disagree with the accounting reports.
- Documents store references and content hashes, never file bytes. Version content is immutable; a correction is a new version.
- Machine extraction output is quarantined as non-authoritative. Only a human other than the extractor can promote it, so no AI output ever becomes a fact by default.
- Exports leave the platform only through a watermarked, expiring, single-use grant bound to one recipient, and every attempt is logged whether it succeeded or not.
- Notifications hold only a masked recipient address. The raw address belongs to identity and the delivery provider, not to the notification history.
- AI narratives are generated from an already-approved report and cite its checksum. They cannot introduce a number that is not already in the source report.

## Case, Governance, and Audit Portal Boundaries

- The case module owns the governance hold registry. A hold placed there propagates into the module that owns the subject, so the hold bites where the action happens rather than only in a compliance screen.
- `isHeld` is a principal-free read so any service can ask whether an action is blocked without needing a compliance permission.
- Compliance rules are declarative data, never executable code. A rule names a source, conditions, and one of three fixed actions; it can never do something the engine does not already support.
- Only an approved rule fires. Every case or hold created by a rule records the rule and the matched conditions, so an automated action is explainable after the fact.
- Read-only access to the case register is granted by case management, governance reporting, or audit portal permission. None of those three opens a write path, so a governance report is never blocked by a missing management grant.
- The audit portal is strictly read-only over other modules. It holds no copy of their records and exposes no command that could change one; the only write it performs is sealing its own evidence package.
- Security events are a filtered view of the same audit trail rather than a separate log, so a security review cannot miss an event the main trail recorded.
- A sealed evidence package fixes a manifest checksum. Later activity on a referenced subject is expected and is reported as divergence rather than suppressed.
- A whistleblowing report stores no reporter identity anywhere. Anonymity is a property of the stored record, not of a display filter.
