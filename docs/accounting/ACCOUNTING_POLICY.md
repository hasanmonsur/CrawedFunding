# Accounting Policy

> **Status: awaiting finance SME approval.** This document records the controls implemented in the
> foundation. It must be reviewed and signed off by a qualified finance or accounting professional,
> together with the posting matrix, before any financial workflow is released.

## Non-negotiable controls

- Use double-entry accounting. Every voucher balances before it can be created and again before it posts.
- Monetary values use fixed precision to four decimal places. All ledger arithmetic runs on integer minor units.
- Every financial record is scoped by organization and project. A voucher line naming another project is refused.
- Posted vouchers and journal entries are immutable. Corrections use a reversal voucher and a new voucher.
- Maker-checker-authorizer applies to controlled vouchers, refunds, releases, and distributions.
- Investor-project ledgers reconcile to control accounts and the general ledger.

## Chart of accounts

Accounts carry a type (`Asset`, `Liability`, `Equity`, `Revenue`, `Expense`), a normal balance, an
optional book type (`Cash` or `Bank`), and optional control-account metadata.

A control account declares a sub-ledger. When it also declares a dimension, every posting to that
account must carry the dimension value, and the sub-ledger is keyed by it. When no dimension is
declared the sub-ledger is keyed by the account code itself. This is why a second bank account is
opened as a second general-ledger account rather than as a dimension value on a shared account.

## Posting matrix

The posting matrix defines, per voucher type, which account types may be debited and credited and
whether supporting evidence is mandatory. It is versioned. An accountant drafts a version; a
different authorized person approves it, which supersedes the previous version. Every voucher
records the matrix version it was validated against, so a historical posting can be explained
against the rules in force at the time.

Version 1 is seeded for local foundation checks and is flagged as a synthetic approval. It carries
no SME sign-off and must be replaced before release.

## Periods and backdating

A period moves through `Open`, `Closing`, `Closed`, and `Locked`. Adjusting entries remain postable
while a period is `Closing`, which is the point of the close window. Once a period is `Closed` or
`Locked` no entry may target it.

An entry whose posting date falls in an earlier open period is a backdated entry. It requires a
documented reason and approval from someone other than its creator before it can post.

## Opening balances

A project records exactly one opening balance voucher. It must be recorded before any other posted
activity and must carry supporting evidence, normally the migrated trial balance.

## Reports

Ledger reports carry as-of metadata and a deterministic SHA-256 checksum over their canonical
content, so an exported or stored report can be shown to be unaltered. Reports are read-only and
require the ledger-read permission; the auditor role holds it without any posting rights.

## Outstanding for SME review

- Confirm the account structure, normal balances, and control-account designations.
- Confirm the posting matrix rules and attachment requirements per voucher type.
- Confirm the loss carry-forward treatment applied at period close.
- Confirm depreciation, accrual, tax, and reserve policies, which the foundation records but does not compute.
- Confirm the presentation and classification used in the balance sheet and cash flow statement.
