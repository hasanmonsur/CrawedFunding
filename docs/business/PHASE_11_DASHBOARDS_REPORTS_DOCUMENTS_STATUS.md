# Phase 11 Dashboards, Reports, Documents, Notifications, and Exports Status

## Implemented in Current Foundation

### Dashboards

- Investor dashboard: invested capital, pending capital, distributions paid and pending, allocations, distribution lines, and KYC actions required.
- Project dashboard: cash at bank, investor capital, revenue, expense, margin, funds deployed, reconciliation exceptions, active holdings, health score, budget variance, milestones, and distributions.
- Administrator dashboard: project count, portfolio cash, revenue, expense, result, reconciliation exceptions, KYC funnel, and a per-project breakdown.
- Every tile names its source. Every dashboard carries generated-at, as-of, and freshness metadata.
- Dashboards degrade rather than fail: a caller missing a permission sees the tile marked `restricted` with its reason, and the rest of the dashboard still renders.

### Control totals

- Project dashboards publish control totals drawn straight from the ledger: bank book closing balance, investor capital control balance, balance-sheet identity, sub-ledger reconciliation state, and the balance-sheet checksum.
- Administrator dashboards publish portfolio cash, portfolio result, and project count.
- Investor dashboards publish statement gross, net, and paid totals against the distribution statement.

### Reports

- A catalogue of fifteen reports spanning accounting, payments, investors, distributions, and audit, each flagged for sensitivity and its masked fields.
- Reports read through to the authoritative service rather than to a cached copy, so a dashboard figure and a report figure cannot disagree.
- Every report returns as-of metadata, period status where applicable, a row count, and a deterministic SHA-256 checksum.

### Documents

- Versioned storage for offers, agreements, KYC, approvals, receipts, invoices, evidence, and statements.
- New versions supersede rather than overwrite; version content is immutable in the application and by database trigger.
- Investors are scoped to their own documents; the investor identifier is resolved through the investor service rather than derived from a user identifier.
- Restricted-classification documents have their extracted fields masked on read.
- OCR and metadata extraction is recorded as non-authoritative machine output. A human other than the extractor must verify it before it becomes authoritative, and corrections require a documented reason.

### Controlled downloads and exports

- Expiring download grants, capped at one hour, single-use by default, bound to the user they were issued to.
- Every grant carries a watermark naming the classification, the recipient, the issue time, and the purpose.
- Every download attempt is logged with its outcome, including expired and exhausted attempts.
- Export requests state a purpose. A masked export of any report proceeds directly; an unmasked export of a sensitive report needs approval from someone other than the requester.
- Generated exports are watermarked, checksummed, recorded against their source report checksum, and delivered through an expiring download grant.

### Notifications

- Email, SMS, push, and in-app channels with versioned templates.
- Templates are drafted and approved by different people; approval supersedes the prior version for that key, channel, and locale.
- Bangla and English templates with locale resolution and explicit English fallback, reported as `localeFallbackApplied`.
- Per-user channel preferences and locale. An opted-out channel suppresses delivery with a stated reason rather than silently dropping the message.
- Placeholder validation refuses to send a template with missing data.
- Deduplication keys prevent a duplicate notification.
- Delivery retries with 1, 5, and 15 minute backoff, stopping after three attempts, with a full delivery attempt log.
- Recipient addresses are masked on the stored record; the raw address never enters the notification history.

### Governed AI assistance

- Report narratives are drafted only from figures already present in an approved report.
- Every sentence cites the source report and its checksum.
- Narratives are marked `authoritative: false` and `requiresHumanReview: true`, and scope identifiers are excluded so the narrative states findings rather than restating its own parameters.

## Control Invariants Under Test

- Project dashboard cash equals the bank book closing balance, and dashboard investor capital equals the investor sub-ledger control balance.
- A restricted tile carries a null value and a reason code; it never shows a stale or partial figure.
- An unmasked sensitive export cannot be generated before an independent approval.
- A masked export never contains the underlying identifier.
- A download grant cannot be redeemed by another user, after expiry, or twice.
- A machine extraction cannot become authoritative without human verification by a second person.
- A suppressed notification is retained with its reason rather than discarded.
- A failed delivery retries on schedule and stops at the attempt limit.

## Current Synthetic API Tokens

- `demo-token-investor-approved`: reads its own dashboard, documents, and statements.
- `demo-token-project-manager`: project dashboard within its assignment, report runs, document management, export requests.
- `demo-token-account-manager`: full financial dashboards, reports, export requests, and export generation.
- `demo-token-compliance`: approves and rejects sensitive exports, verifies document extractions.
- `demo-token-project-admin`: administrator dashboard, notification template management and approval, document management.
- `demo-token-auditor`: dashboards, reports, documents, and the document access log, with no write rights.

## API Surface

- `GET /api/v1/dashboards/investor`
- `GET /api/v1/dashboards/project`
- `GET /api/v1/dashboards/administrator`
- `GET /api/v1/reports`
- `GET /api/v1/reports/run`
- `GET /api/v1/reports/narrative`
- `GET /api/v1/exports`
- `POST /api/v1/exports`
- `POST /api/v1/exports/approve`
- `POST /api/v1/exports/reject`
- `POST /api/v1/exports/generate`
- `GET /api/v1/documents`
- `POST /api/v1/documents`
- `GET /api/v1/documents/detail`
- `POST /api/v1/documents/versions`
- `POST /api/v1/documents/extractions`
- `POST /api/v1/documents/extractions/verify`
- `POST /api/v1/documents/download-grants`
- `POST /api/v1/documents/downloads`
- `GET /api/v1/documents/access-log`
- `GET /api/v1/notifications/templates`
- `POST /api/v1/notifications/templates`
- `POST /api/v1/notifications/templates/approve`
- `GET /api/v1/notifications/preferences`
- `PATCH /api/v1/notifications/preferences`
- `GET /api/v1/notifications`
- `POST /api/v1/notifications`
- `POST /api/v1/notifications/process-queue`
- `GET /api/v1/notifications/delivery-attempts`

## Exit Gate Evidence

- Dashboard control totals are asserted equal to the bank book, investor sub-ledger, balance sheet, and reconciliation reports, both in package tests and end to end over the API.
- An unmasked sensitive export is refused with `export_not_approved` until an independent approver signs it off, and self-approval is refused with a four-eyes error.
- A masked export is verified not to contain the underlying investor identifier.
- Every report and every export carries as-of metadata and a checksum; the export also records the checksum of the report it was generated from.

## Remaining Phase 11 Work

- Persist documents, versions, extractions, grants, access logs, templates, preferences, notifications, delivery attempts, and export requests in PostgreSQL repositories.
- Add scheduled report runs and a delivery calendar; exports are currently on demand only.
- Replace the recording notification transport with real email, SMS, and push providers, including provider delivery receipts.
- Add a real OCR engine behind the extraction interface; the current engine field is synthetic.
- Add object-storage integration so a download grant resolves to a genuine expiring storage URL rather than a synthetic reference.
- Add PDF and XLSX export renderers alongside CSV and JSON.
- Have a Bangla-speaking reviewer approve the seeded Bangla templates, which are currently marked as synthetic approvals.
