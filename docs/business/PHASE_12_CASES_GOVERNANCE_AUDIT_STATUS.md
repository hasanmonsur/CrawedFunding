# Phase 12 Complaints, Risk, Compliance, Governance, and Audit Portal Status

## Implemented in Current Foundation

### Complaints

- Registration with category, severity, project, investor, evidence document references, and channel.
- Full lifecycle: registered, triaged, assigned, in progress, escalated, resolved, closed, under appeal, withdrawn, rejected.
- Service level targets derived from severity, producing an acknowledge deadline and a resolve deadline at registration.
- SLA state is computed from the clock on every read rather than stored, so it cannot drift and it follows a severity change automatically.
- An SLA breach queue lists every complaint past either deadline.
- Escalation, appeal, and withdrawal each require a documented reason and are recorded in an append-only history.
- The person who raised a complaint cannot be the person who resolves it.
- An investor can read and appeal their own complaint but cannot read the queue or another investor's complaint.

### Whistleblowing

- Fraud and misuse-of-funds reports route to the whistleblowing channel automatically, as does any report raised anonymously.
- A whistleblowing report stores no reporter identity and no investor identity, and its history records the registration actor as `anonymous`.
- Every whistleblowing report opens a linked high-severity compliance case immediately.

### Compliance and risk cases

- Cases raised from KYC, project, payment, fraud signal, duplicate detection, unusual pattern, complaint, and whistleblowing sources.
- Lifecycle: open, under investigation, pending information, escalated, resolved, closed, rejected, with a recorded history.
- A case cannot be resolved while it still has an active hold attached to it.

### Case linking

- Cases link to investors, projects, payments, documents, vouchers, complaints, other cases, and distributions.
- Linking is queryable from both directions: by case to find every entity, and by entity to find every case that touches it.

### Governance holds

- A single hold registry covering investors, payments, projects, refunds, and distributions.
- At most one active hold per subject, enforced in code and by a partial unique index.
- An investor hold propagates to the investor module so it bites where the action happens.
- Whoever placed a hold cannot be the one who lifts it, and a release requires a documented reason.
- A principal-free `isHeld` read lets any service ask whether an action is blocked.

### Compliance rule engine

- Rules are declarative data, never code: a source, a match mode, a list of field/operator/value conditions, and an action.
- Eight validated operators, with unknown operators and unknown actions refused at draft time.
- Actions open a compliance case, raise a governance hold, or flag a pattern.
- Rules are versioned and approved by someone other than the drafter; approval supersedes the prior version and only approved rules fire.
- A suspended rule stops firing immediately and records why it was suspended.
- Every case or hold a rule creates records which rule fired and which conditions matched, so an automated action is always explainable.
- Seeded rules are flagged as synthetic approvals pending a compliance owner's review.

### Audit portal

- Read-only search across every module's audit trail, filterable by entity, actor, action prefix, correlation id, and date range.
- Full chronological history for any entity, including the compliance cases that reference it.
- A security event view derived from the same trail, so a security review cannot miss an event the main trail recorded.
- The portal exposes no command that mutates another module; a test asserts the surface stays read-only.

### Evidence packages

- Independent audit evidence packages built from case links or explicit entity references.
- Sealing fixes a manifest checksum, after which the package is immutable in the application and by database trigger.
- Verification reports whether the sealed manifest is intact and whether each artefact has changed since sealing, so later activity is visible rather than hidden.

### Governance and regulatory reporting

- A board-ready governance report covering open complaints by severity and category, SLA breaches, whistleblowing volume, compliance cases by severity and source, rule-triggered cases, active holds by subject, reconciliation exceptions, period lock status, and export approvals.
- Three regulatory templates, each enumerated with its measures and each explicitly marked as not approved for submission.
- An unknown regulatory template is refused rather than improvised.

### Governed AI assistance

- Complaint classification suggests a category and severity with a confidence and a per-keyword explanation.
- Drafted complaint responses state only what the case record holds and never assert an outcome that has not been decided.
- Both are marked `authoritative: false` and `requiresHumanApproval: true`; neither changes a complaint. A human must apply a classification with a written rationale.

## Control Invariants Under Test

- A whistleblowing report contains no trace of who raised it.
- A complaint cannot be resolved by its own reporter.
- SLA breach state follows the clock and a re-classification moves the deadlines.
- A hold cannot be released by whoever placed it, and a second active hold on the same subject is refused.
- A compliance case cannot close while a hold it owns is still active.
- An unapproved or suspended rule never fires.
- Reading the audit trail leaves the traced record byte-for-byte unchanged.
- A sealed evidence package cannot be re-sealed, and divergence from its manifest is detectable.
- AI classification never changes a complaint without a human rationale.

## Current Synthetic API Tokens

- `demo-token-investor-approved`: registers, reads, and appeals its own complaints.
- `demo-token-compliance`: triages, assigns, resolves, opens and investigates cases, places holds, drafts rules, and reads the audit portal.
- `demo-token-project-admin`: closes complaints, releases holds, approves and suspends rules, reads governance reports.
- `demo-token-voucher-authorizer`: releases governance holds.
- `demo-token-auditor`: reads the audit portal, builds and seals evidence packages, reads governance reports, and can change nothing.

## API Surface

- `GET /api/v1/complaints`, `POST /api/v1/complaints`, `GET /api/v1/complaints/detail`
- `POST /api/v1/complaints/triage`, `/assign`, `/start`, `/escalate`, `/resolve`, `/close`, `/appeal`, `/withdraw`
- `GET /api/v1/complaints/sla-breaches`
- `GET /api/v1/complaints/classification`, `POST /api/v1/complaints/classification`
- `GET /api/v1/complaints/draft-response`
- `GET /api/v1/compliance-cases`, `POST /api/v1/compliance-cases`
- `POST /api/v1/compliance-cases/advance`, `POST /api/v1/compliance-cases/resolve`
- `GET /api/v1/compliance-cases/links`, `POST /api/v1/compliance-cases/links`
- `GET /api/v1/governance/holds`, `POST /api/v1/governance/holds`, `POST /api/v1/governance/holds/release`
- `GET /api/v1/compliance-rules`, `POST /api/v1/compliance-rules`
- `POST /api/v1/compliance-rules/approve`, `POST /api/v1/compliance-rules/suspend`
- `GET /api/v1/compliance-signals`, `POST /api/v1/compliance-signals`
- `GET /api/v1/audit-portal/trail`, `/entity-history`, `/security-events`
- `GET /api/v1/audit-portal/evidence-packages`, `POST /api/v1/audit-portal/evidence-packages`
- `POST /api/v1/audit-portal/evidence-packages/seal`, `GET /api/v1/audit-portal/evidence-packages/verify`
- `GET /api/v1/governance/report`, `/regulatory-templates`, `/regulatory-report`

## Exit Gate Evidence

- Compliance can place a hold, investigate, and resolve a case, and the case is refused resolution while a hold remains active.
- An auditor traces a complaint's full history and the source record is asserted unchanged before and after, both in package tests and end to end over the API.
- The audit portal surface is asserted to contain no mutating command.
- Complaint SLA behaviour is covered by tests for derived breaches and re-classification, but end-user SLA UAT with a complaints owner is still outstanding.

## Remaining Phase 12 Work

- Persist complaints, complaint history, evidence links, compliance cases, case links, holds, rules, signals, and evidence packages in PostgreSQL repositories.
- Run complaint SLA UAT with a complaints owner and confirm the severity targets, which are currently platform operating assumptions rather than an agreed commitment.
- Have a compliance owner review and approve the seeded rules and the regulatory templates, replacing the synthetic approvals.
- Add automatic SLA escalation on breach, wired to the Phase 11 notification queue, instead of manual escalation only.
- Add a whistleblower correspondence channel that preserves anonymity while allowing follow-up questions.
- Add evidence package export as a downloadable, watermarked bundle through the Phase 11 document grant mechanism.
- Extend the rule engine with time-window and aggregate conditions; conditions are currently evaluated against a single signal payload.
