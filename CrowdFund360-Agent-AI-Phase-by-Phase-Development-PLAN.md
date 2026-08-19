# CrowdFund360 Agent AI Phase-by-Phase Development PLAN

**Source documents analyzed**

- `CrowdFund360-Business-Blueprint.md`
- `CrowdFund360-Solution-Architecture-Document.md`
- `CrowdFund360-Agent-AI-Technical-Development-Plan.md`

**Planning stance:** Build CrowdFund360 as a controlled financial administration, accounting, compliance, and investor transparency platform first. Marketplace growth, automation, mobile, enterprise tenancy, and advanced AI should come only after the financial-control foundation is proven.

**Mandatory boundary:** No public fundraising, regulated securities, lending, deposit-taking, custody, guaranteed-return product, secondary transfer, or autonomous AI financial decision may be enabled without written legal, compliance, finance, security, and release approval.

---

## 1. Target Product Scope

CrowdFund360 must support:

- Multiple organizations and tenant-level configuration.
- Multiple independent projects per organization.
- Project-wise plans, offers, budgets, documents, risks, milestones, ledgers, P&L, cash flow, dashboards, and closure.
- One investor investing in multiple projects, with a separate investor-project ledger for each investment.
- Online and assisted offline onboarding.
- KYC, AML, source-of-funds, beneficial ownership, risk screening, and case management.
- Investment commitment, agreement acceptance, payment reference, reconciliation, allocation, receipt, refund, and distribution.
- Double-entry accounting with maker-checker-authorizer controls.
- Project operations, procurement, expenses, assets, milestone-based release, profit/loss close, and investor distribution.
- Investor, project, accounts, compliance, administrator, audit, and management dashboards.
- Versioned documents, notifications, complaints, reporting, audit trail, integrations, and governed AI assistance.

---

## 2. Recommended Technical Baseline

### Application Architecture

- Investor Web: Next.js/React, TypeScript.
- Operations Web: Next.js/React, TypeScript.
- Investor Mobile: React Native after the web core stabilizes.
- Backend API: NestJS/Node.js modular monolith.
- Background Workers: NestJS workers with BullMQ or equivalent.
- Database: PostgreSQL as source of truth.
- Cache/queues/rate limits: Redis.
- Documents/media: encrypted S3-compatible object storage.
- Reporting: PostgreSQL read models first; warehouse/OpenSearch later.
- Observability: OpenTelemetry, structured logs, Prometheus/Grafana.

### Architecture Principles

- Modular monolith first, with strict domain boundaries and extractable modules.
- PostgreSQL transactions and constraints for accounting and project isolation.
- Explicit command APIs for approve, reject, post, reverse, reconcile, release, refund, and distribute.
- Transactional outbox/inbox for reliable async workflows.
- Idempotency keys for money movement, workflow actions, callbacks, posting, refunds, and distributions.
- Immutable posted financial records; corrections use reversal and new voucher.
- RBAC plus ABAC by tenant, project, role, status, monetary limit, and assignment.
- Human approval for accounting, legal, compliance, security, and production fund-flow decisions.

---

## 3. Agent AI Delivery Model

### Agent Roles

- Product Agent: stories, acceptance criteria, traceability, gap analysis.
- Architecture Agent: ADRs, module boundaries, dependency rules, data contracts.
- Backend Agent: domain, API, database, workers, integrations.
- Frontend Agent: investor web, operations web, accessibility, state handling.
- Mobile Agent: React Native investor features.
- Test Agent: unit, integration, E2E, property, fixture, regression tests.
- Security Agent: threat modeling, SAST/SCA review, tenant isolation, abuse cases.
- Data Agent: migrations, indexes, reporting models, data integrity checks.
- Documentation Agent: OpenAPI, runbooks, user/admin guides.
- Review Agent: independent diff review and quality gate checks.

### Rules for Every Agent Task

- Work on one bounded capability at a time.
- Read approved requirements, glossary, ADRs, and module ownership before editing.
- Do not invent accounting, legal, tax, KYC, suitability, or distribution rules.
- Include tests with every behavioral change.
- Never bypass authorization, project isolation, maker-checker, approval limits, period locks, or audit trails.
- Never use real PII, bank details, NID data, credentials, or production secrets.
- Report changed files, validation evidence, residual risks, and unresolved decisions.

---

## 4. Phase Plan

## Phase 0: Business, Legal, Accounting, and Control Definition

**Goal:** Remove ambiguity before software construction.

**Business features**

- Select initial pilot model: private invitation-only profit-sharing or revenue-sharing, subject to legal approval.
- Define investor types, sponsor types, project categories, eligibility, investment limits, project states, and offer states.
- Define funding threshold, cap, overfunding, cancellation, refund, default, material change, closure, and complaint policies.
- Define fee model, sponsor subscription, setup fee, success fee, accounting add-on, and pass-through charges.
- Define pilot KPIs: approved projects, verified investors, administered funding, reconciliation rate, KYC SLA, period-close duration, complaint resolution.

**Finance/compliance features**

- Approve chart of accounts, posting matrix, voucher types, period close, reversal, reserves, tax/withholding, P&L, loss carry-forward, and distribution rules.
- Define KYC, AML, PEP/sanctions, beneficial ownership, source-of-funds, retention, privacy, and data subject request procedures.
- Define project due-diligence checklist, risk score methodology, independent review thresholds, and fraud controls.

**Technical deliverables**

- Domain glossary and context map.
- Business state machines for Project, KYC, Investment, Voucher, Payment, Reconciliation, Distribution, Complaint.
- Requirements traceability matrix.
- Role-permission-approval matrix.
- Initial OpenAPI resource catalogue.
- Threat model and data classification register.
- Architecture Decision Records for modular monolith, PostgreSQL, Redis, object storage, authentication, outbox, and reporting.

**Agent AI tasks**

- Convert approved policies into epics, stories, acceptance criteria, and test scenarios.
- Generate process diagrams, state tables, exception catalogues, and role matrices.
- Detect missing decisions and contradictions for human review.

**Exit gate**

- Product, finance, legal/compliance, architecture, and security approve the baseline.

---

## Phase 1: UX, Architecture, Repository, and Engineering Foundation

**Goal:** Create a secure, testable, localized platform foundation.

**Basic features**

- Monorepo structure for API, worker, investor web, operations web, mobile, shared packages, database, infrastructure, and docs.
- Local development with Docker Compose for PostgreSQL, Redis, object storage, API, worker, and web apps.
- CI/CD with locked dependencies, linting, formatting, type checking, unit tests, migration checks, SAST, secret scanning, dependency scanning, SBOM, and build artifacts.
- Standard API envelope, problem-details errors, pagination, filtering, sorting, correlation IDs, idempotency headers, and ETag/version support.
- Shared UI component library with Bangla/English localization, BDT formatting, accessibility states, validation states, loading/empty/error states.
- Health/readiness endpoints, structured JSON logs, OpenTelemetry traces, and baseline metrics.

**Advanced foundation**

- Feature flags and environment-specific configuration.
- Audit metadata conventions on all mutable records.
- Transaction wrapper and outbox/inbox infrastructure.
- Architecture tests to enforce module boundaries.
- Seed packs with synthetic data only.
- Initial vertical slice from UI to API to PostgreSQL with audit log and trace correlation.

**Agent AI tasks**

- Scaffold repository, module skeletons, shared DTO/validation packages, test harness, and local setup docs.
- Generate ADR drafts and initial OpenAPI structure.
- Create CI workflows and sample module tests.

**Exit gate**

- One secure vertical slice passes CI, traces correlate across components, and architecture/security review passes.

---

## Phase 2: Identity, Organization, RBAC/ABAC, MFA, and Audit

**Goal:** Establish secure access, tenant/project scope, and segregation of duties.

**Basic features**

- User registration, invitation, login, logout, password reset, email/mobile verification, OTP, session management.
- Organization and tenant setup.
- Roles: Investor, Project Manager, Account Manager, Voucher Authorizer, Compliance Officer, Project Administrator, Auditor, Super Administrator.
- Project-scoped assignments.
- Permissions for menus, APIs, data access, exports, and sensitive actions.
- User activation, suspension, lockout, expiry, and access review.
- Audit events for auth, authorization, data changes, exports, and approvals.

**Advanced features**

- MFA for privileged users.
- RBAC plus ABAC for tenant, project, role, status, amount, assignment, and approval limit.
- Delegation with effective dates and expiry.
- Four-eyes rule: creator cannot finally approve controlled action.
- Step-up authentication for sensitive actions.
- Conflict-of-interest declaration.
- Break-glass access with reason, expiry, alert, and post-review.

**Agent AI tasks**

- Implement identity and organization modules.
- Generate authorization matrix tests and negative access tests.
- Add audit middleware/interceptors and masking patterns.

**Exit gate**

- Cross-tenant and cross-project access attempts fail securely, authorization matrix tests pass, and Security approves controls.

---

## Phase 3: Sponsor, Project, Offer, Due Diligence, and Publication

**Goal:** Manage project declaration through approved, versioned publication.

**Basic features**

- Sponsor registration and business profile.
- Project draft, submit, review, approve, publish, pause, reject, cancel, close.
- Project manager, account manager, compliance officer, and administrator assignment.
- Project category, sector, location, legal entity, team, contact, funding target, threshold, cap, duration, dates, min/max investment, and units.
- Business plan, use of funds, revenue model, budget, forecast, break-even, risks, exit plan, documents, images, and videos.
- Milestones, deliverables, evidence, schedule, progress percentage.

**Advanced features**

- Configurable due-diligence checklist and evidence requirements.
- Sponsor ownership, directors, beneficial owners, licenses, litigation, assets, contracts, insurance, and tax information.
- Findings, remediation, comments, sign-off, independent reviewer for high-risk/high-value projects.
- Risk score across sponsor, market, finance, execution, legal, liquidity, governance, and concentration.
- Conservative/base/optimistic forecasts, sensitivity analysis, assumption register.
- Versioned published offer; investor retains exact accepted version.
- Material-change workflow with reapproval and investor notice/consent.
- Project templates by sector.

**Agent AI tasks**

- Build project, sponsor, due-diligence, risk, offer-version, and document links.
- Generate project state-machine tests and publication permission tests.
- Draft content completeness checks and risk-score explanation screens.

**Exit gate**

- A pilot project moves from draft to approved publication, every published field is versioned, and unapproved projects cannot accept commitments.

---

## Phase 4: Investor Registration, KYC, AML, and Service Profile

**Goal:** Onboard investors safely through online and assisted offline flows.

**Basic features**

- Individual and institutional investor profiles.
- Online self-registration and assisted/offline registration.
- OTP verification for mobile/email.
- NID/passport, photograph, address, date of birth, occupation, income band, tax information.
- Institutional documents, directors, and beneficial owners.
- Bank account, nominee/beneficiary, emergency contact.
- Consent, privacy notice, risk acknowledgement, terms acceptance, e-signature evidence.
- Document upload, preview, replace, verify, reject, expiry.
- KYC states: Draft, Submitted, Under Review, Information Required, Approved, Rejected, Expired, Suspended.
- Reviewer queue, SLA, comments, and notifications.

**Advanced features**

- Source-of-funds and source-of-wealth declarations.
- Duplicate detection across identity, mobile, email, bank account, device, and address.
- PEP/sanctions/provider screening when legally authorized.
- Enhanced due diligence for high-risk cases.
- Periodic KYC review and expiring-document alerts.
- Suspicious-activity cases and controlled account hold.
- Beneficial-ownership hierarchy for institutions.
- Data retention, masking, consent, and data subject request controls.

**Agent AI tasks**

- Implement investor, KYC case, documents, bank, nominee, consent, and review queues.
- Generate synthetic KYC fixtures and workflow tests.
- Add AI-assisted document classification only as draft metadata requiring human verification.

**Exit gate**

- Approved, rejected, information-required, expired, duplicate, suspicious, and assisted-onboarding scenarios pass UAT.

---

## Phase 5: Marketplace, Disclosure, Suitability, Commitment, and Agreement

**Goal:** Let eligible investors discover projects and create controlled commitments.

**Basic features**

- Project list/detail, filters by sector/location/model/risk/status, search, sort, watchlist, compare.
- Funding progress, days remaining, min investment, risk band, fees, status, sponsor, documents, updates, and FAQs.
- Prominent risk warnings and standardized disclosures.
- Eligibility checks for KYC, project status, investor limit, project limit, and concentration.
- Suitability questionnaire and risk acknowledgement.
- Investment amount/unit selection and fee/net calculation.
- Agreement generation and electronic acceptance.
- Commitment reservation with expiry.
- States: Draft, Reserved, Awaiting Payment, Paid, Allocated, Cancelled, Expired, Refunded, Rejected.

**Advanced features**

- Waitlist and controlled oversubscription.
- Investor classes and project-specific limits.
- Related-party and concentration warnings.
- Material-change re-consent.
- Offer analytics that protects investor identity.

**Agent AI tasks**

- Implement marketplace read models, offer detail, commitment commands, agreement acceptance, and limit validators.
- Generate suitability, concentration, expiry, and offer-version tests.

**Exit gate**

- One approved investor can commit to multiple projects, accepted offer versions are immutable, and limits are enforced at API/database levels.

---

## Phase 6: Payments, Bank References, Escrow Support, Refunds, and Reconciliation

**Goal:** Record, verify, allocate, refund, and reconcile funds safely.

**Basic features**

- Unique project/investor/commitment payment reference.
- Manual bank-transfer instructions and proof upload.
- Authorized bank statement import.
- Payment recording, checking, matching, rejection, and reversal.
- Official receipt only after cleared/reconciled payment.
- Partial, over, under, duplicate, unmatched, returned, and failed payment states.
- Refund proposal and maker-checker authorization.

**Advanced features**

- Payment gateway, bank API, card, MFS, or BanglaQR when legally approved.
- Signed webhooks/callbacks with timestamp, nonce, replay protection, and deduplication.
- Idempotency for initiation, callback, allocation, refund, and receipt.
- Partner settlement ingestion.
- Escrow/trust or segregated project-account support where required.
- Exact, probable, split, aggregate, and manual reconciliation matching.
- Daily opening + inflow - outflow = closing control.
- Reconciliation approval and lock.

**Agent AI tasks**

- Build payment reference generation, statement import parser, reconciliation queues, refund workflow, and provider adapter interfaces.
- Generate duplicate callback, replay, idempotency, split match, and mismatch tests.
- Add AI reconciliation recommendation as non-authoritative candidate matching.

**Exit gate**

- Replayed callbacks cannot duplicate funds or ledger entries, payment totals reconcile to allocations and GL, and refunds require separated approval.

**Foundation implementation status**

- Implemented escrow and segregated project accounts with co-mingling prevention, the full partial/over/under/duplicate/unmatched/returned/failed payment state set, signed provider callbacks with timestamp tolerance, nonce replay rejection and event deduplication, partner settlement ingestion, exact/probable/split/aggregate/manual matching, non-authoritative AI match candidates with explanations, reconciliation maker-checker approval and immutable lock, reversal, cleared-payment gating, idempotent receipts, refund propose/approve/execute separation, the daily opening + inflow - outflow = closing control, a PostgreSQL blueprint, and property tests for settlement conservation.
- Remaining advanced work: persisted repositories, live gateway/card/BanglaQR adapters once legally approved, bank statement format parsers, automatic posting of cleared payments into Phase 7 accounting, and reconciliation ageing and escalation dashboards in Phase 11.

---

## Phase 7: Core Double-Entry Project Accounting

**Goal:** Establish authoritative financial truth.

**Basic features**

- Chart of accounts and fiscal periods.
- Opening balances.
- Journal, receipt, payment, contra, purchase, sales, accrual, adjustment, depreciation, and distribution voucher types.
- Maker-checker-authorizer voucher workflow.
- Voucher attachments, narration, cost center, milestone, vendor, investor, and project references.
- Balanced posting, atomic transactions, posted-entry immutability.
- Period locks, reversal workflow, and controlled backdated entries.
- Trial balance, general ledger, cash book, bank book, P&L, balance sheet, and cash-flow reports.

**Advanced features**

- Investor, vendor, bank, receivable, payable, asset, inventory, reserve, tax, and platform-fee sub-ledgers.
- Project accounting dimensions and strict no-cross-project posting except explicit inter-project process.
- Property-based accounting invariant tests.
- Report checksums and as-of period metadata.
- Accountant-approved posting matrix versioning.

**Agent AI tasks**

- Implement accounting domain, voucher workflow, journal posting, reports, period locking, and reversal.
- Generate invariant tests for balance, immutability, idempotency, project isolation, period locks, and ledger reconciliation.
- AI may suggest voucher narration/account category, but humans approve checked/authorized vouchers.

**Exit gate**

- Every posted voucher balances, investor ledgers reconcile to control accounts, and accountant UAT approves reports.

**Foundation implementation status**

- Implemented the full voucher type catalogue, versioned accountant-approved posting matrix with maker-checker, opening balances, voucher attachments and accounting dimensions, atomic posting, posted-entry immutability enforced in code and by database trigger, posting-date period resolution with controlled backdated-entry approval, strict no-cross-project posting, ten sub-ledgers keyed off control accounts, sub-ledger to control-account reconciliation, cash book, bank book, balance sheet, cash flow and fund-utilization reports, deterministic report checksums with as-of metadata, cleared-payment integration that drafts a receipt voucher for human posting, a PostgreSQL blueprint, and property tests for balance, immutability, project isolation, and ledger reconciliation invariants.
- Remaining advanced work: persisted repositories, finance SME approval replacing the synthetic seeded posting matrix and accounting policy, an explicit inter-project transfer process, multi-currency accounting with FX revaluation, report snapshot persistence, and accountant UAT sign-off of the reports.

---

## Phase 8: Budget, Procurement, Expenses, Assets, and Project Operations

**Goal:** Track operational use of funds and project expenditure.

**Basic features**

- Project budget lines, revisions, approvals, available budget, actuals, commitments, and variance.
- Vendors, procurement requests, purchase orders, invoices, receipts, expense claims, and payment vouchers.
- Advances, prepayments, accruals, payables, and expense categories.
- Asset and inventory records with purchase, location, custodian, depreciation, disposal, and evidence.

**Advanced features**

- Budget threshold alerts and approval limits.
- Procurement comparison, conflict-of-interest declaration, and related-party checks.
- Milestone/cost-center allocation.
- Forecast vs actual cost tracking.
- Contract obligations and recurring expense schedules.

**Agent AI tasks**

- Implement budget, procurement, vendor, expense, asset, inventory, and payable workflows.
- Generate budget-availability and approval-limit tests.

**Exit gate**

- Expenses cannot exceed controlled rules without approval, and budget reports reconcile to posted accounting data.

**Foundation implementation status**

- Implemented budget revisions, approval, available-budget checks, procurement requests, expense claims, asset registration, budget variance API, PostgreSQL table blueprint, and automated tests.
- Remaining advanced work: vendor master, purchase orders, goods receipts, invoice matching, depreciation, budget alerts, and accounting voucher integration.

---

## Phase 9: Milestone-Based Fund Release and Project Monitoring

**Goal:** Release project funds through evidence-based controls.

**Basic features**

- Milestone plans, deliverables, evidence upload, progress updates, review comments.
- Fund-release request, manager verification, finance/compliance approval, voucher posting, and notification.
- Project updates and investor-visible progress timeline.
- Schedule variance and delayed milestone alerts.

**Advanced features**

- Independent verification for high-value/high-risk milestones.
- Material-change triggers from delay, cost overrun, risk escalation, or failed evidence.
- Health score combining finance, schedule, compliance, documents, and risk.
- Investor notice/consent workflow where required.

**Agent AI tasks**

- Implement milestone evidence workflow, release commands, health read models, and investor update feeds.
- Add AI project-plan completeness and milestone-delay indicators with explanation and human review.

**Exit gate**

- Funds cannot release without approved conditions, evidence, permission, limits, and posted accounting entries.

**Foundation implementation status**

- Implemented milestone planning, evidence submission, independent verification, fund release request, finance approval, compliance approval, posted-voucher verification, release marking, investor update timeline, delay alerts, health read model, PostgreSQL table blueprint, and automated tests.
- Remaining advanced work: third-party verification, material-change workflows, investor notice/consent, notification delivery, and persisted release queues.

---

## Phase 10: Period Close, P&L, Loss Treatment, and Investor Distribution

**Goal:** Calculate and distribute approved financial results.

**Basic features**

- Period-close checklist, reconciliation checks, accruals, adjustments, depreciation, tax/reserve inputs.
- P&L calculation from locked/approved accounting periods.
- Distribution formula versioning.
- Distribution proposal, review, approval, investor entitlement, payable posting, and statements.
- Payment batch export or provider submission.
- Paid, failed, returned, held, reissued, reconciled, completed states.

**Advanced features**

- Prior loss carry-forward according to approved policy.
- Holding-period or unit/capital based pro-rata allocation.
- Rounding and residual handling.
- Tax/withholding records.
- Suspended/expired/mismatched investor holds.
- Final project closure, settlement, archive, final statements.

**Agent AI tasks**

- Implement close, profit calculation, distribution batch, entitlement, payable, and statement workflows.
- Generate property tests for distribution invariants, rounding, eligibility, holds, and reconciliation.

**Exit gate**

- Finance validates P&L and distribution calculations independently, and no distribution can proceed from unlocked or unreconciled periods.

**Foundation implementation status**

- Implemented fiscal-period close workflow with checklist gates, adjusting-entry window, balanced-ledger check, period rollover, independent lock, period-scoped profit and loss, prior-loss carry-forward, distribution formula versioning, exact integer pro-rata entitlement calculation with rounding and residual policy, reserve and withholding treatment, holding-period eligibility, investor holds, independent review and limit-bound approval, posted-voucher-gated payable, payout batches, payment results with reissue, reconciliation, completion, investor statements, project settlement and archive, a PostgreSQL blueprint, and property tests for distribution invariants.
- Remaining advanced work: persisted repositories, automated accrual and depreciation schedules, jurisdiction-specific tax certificates, provider-native payout submission and return-file ingestion, statement document generation and notification delivery, and multi-currency distributions.

---

## Phase 11: Dashboards, Reports, Documents, Notifications, and Exports

**Goal:** Give stakeholders transparent, controlled visibility.

**Basic features**

- Investor dashboard: invested capital, project allocation, status, updates, paid/pending distributions, documents, statements, KYC actions, service requests.
- Project dashboard: funding, cleared payments, allocations, budget vs actual, cash, revenue, expense, margin, receivables, payables, milestones, risks, distributions.
- Administrator dashboard: portfolio funding, cash, revenue, expense, P&L, investor growth, KYC funnel, complaints, voucher queues, reconciliation exceptions, platform revenue.
- Reports: trial balance, GL, cash flow, balance sheet, fund utilization, investor statement, project statement, KYC/compliance, complaint SLA, audit exports.
- Versioned document storage for offers, agreements, KYC, approvals, receipts, invoices, evidence, statements.
- SMS, email, push, and in-app notifications with templates, preferences, delivery logs, and retries.

**Advanced features**

- Scheduled reports with approval for sensitive exports.
- Watermarked downloads, expiring URLs, export audit, and masking.
- OCR and metadata extraction with human verification.
- Dashboard freshness indicators and control totals.
- Multilingual notifications in Bangla and English.

**Agent AI tasks**

- Build read models, dashboard APIs, document templates, export generators, notification providers, and report controls.
- Use AI for report narrative drafts only from approved metrics with citation to source reports.

**Exit gate**

- Dashboards reconcile to authoritative ledgers, sensitive exports are masked/audited, and reports include as-of data metadata.

**Foundation implementation status**

- Implemented investor, project, and administrator dashboards with named tile sources, freshness metadata, and ledger-derived control totals; permission-aware tiles that degrade to a restricted marker instead of failing; a fifteen-report catalogue reading through to authoritative services with as-of metadata and checksums; versioned immutable document storage with investor scoping and classification-driven masking; OCR extraction that stays non-authoritative until a second person verifies it; watermarked, expiring, single-use, actor-bound download grants with a full access log; export requests with masking, purpose, independent approval for unmasked sensitive data, watermarks, checksums, and source-report traceability; Bangla and English notification templates with maker-checker approval, per-user channel and locale preferences, suppression, deduplication, and retry with backoff and delivery logs; governed AI report narratives cited to an approved report checksum and marked non-authoritative; a PostgreSQL blueprint; and tests asserting dashboard-to-ledger reconciliation end to end.
- Remaining advanced work: persisted repositories, scheduled report runs, real email/SMS/push providers, a real OCR engine, object-storage backed expiring URLs, PDF and XLSX renderers, and Bangla template review by a native speaker.

---

## Phase 12: Complaints, Risk, Compliance, Governance, and Audit Portal

**Goal:** Operate the platform with case control, governance, and auditability.

**Basic features**

- Complaint registration, category, severity, project, evidence, assignment, SLA, escalation, resolution, appeal.
- Whistleblowing route for suspected fraud or misuse.
- Risk and compliance cases from KYC, project, payment, fraud signals, duplicate detection, and unusual patterns.
- Holds on investors, payments, projects, refunds, and distributions.
- Audit portal with read-only access to transactions, approvals, documents, state changes, exports, and security events.

**Advanced features**

- Compliance rule engine.
- Case linking across investor, project, payment, document, voucher, and complaint.
- Management governance reports and board-ready summaries.
- Regulatory reporting templates where approved.
- Independent audit evidence packages.

**Agent AI tasks**

- Implement case management, rule triggers, audit search, evidence packaging, and governance reports.
- Add AI complaint classification and draft response with mandatory human approval.

**Exit gate**

- Compliance can hold and resolve cases safely, auditors can trace full history without changing records, and complaint SLA UAT passes.

**Foundation implementation status**

- Implemented the full complaint lifecycle with severity-derived service levels computed from the clock rather than stored, an SLA breach queue, escalation, appeal and withdrawal with documented reasons, and an append-only history; an anonymous whistleblowing route that stores no reporter identity and opens a linked high-severity case; compliance and risk cases across eight signal sources with bidirectional case linking; a unified governance hold registry over investors, payments, projects, refunds and distributions with one active hold per subject, investor-module propagation and independent release; a declarative versioned compliance rule engine whose approved rules open cases, raise holds or flag patterns and always record which rule and which conditions fired; a strictly read-only audit portal with filtered trail search, per-entity history, a derived security event view, and sealed verifiable evidence packages; board-ready governance reporting and enumerated regulatory templates that are explicitly not approved for submission; advisory AI complaint classification and drafted responses that cannot change a case without a written human rationale; a PostgreSQL blueprint; and tests asserting an audit read leaves the traced record unchanged.
- Remaining advanced work: persisted repositories, complaint SLA UAT with a complaints owner, compliance owner approval of the seeded rules and regulatory templates, automatic SLA escalation wired to the notification queue, an anonymity-preserving whistleblower correspondence channel, evidence package download bundles, and time-window and aggregate rule conditions.

---

## Phase 13: Mobile Investor App and Assisted Operations

**Goal:** Extend the validated web experience to mobile and field-assisted channels.

**Basic features**

- Investor login, MFA/OTP, profile, KYC status, document capture, project discovery, watchlist, commitment status, portfolio, statements, notifications, complaints.
- Push notifications and device/session management.
- Responsive assisted mode for authorized field agents.

**Advanced features**

- Offline capture queue for assisted onboarding with controlled sync.
- Device, location, timestamp, agent identity, and investor acknowledgement evidence.
- Camera/document quality checks.
- Mobile biometric unlock where supported.

**Agent AI tasks**

- Build React Native app using shared contracts and business rules from the API.
- Generate mobile E2E flows and accessibility checks.

**Exit gate**

- Mobile cannot bypass central KYC, limits, suitability, payment, or approval rules.

---

## Phase 14: Advanced Integrations and API Ecosystem

**Goal:** Automate provider workflows and support partner expansion.

**Basic integrations**

- SMS/email/push providers.
- Bank statement import.
- Payment gateway or bank/MFS provider where legally approved.
- KYC/NID/business verification provider where authorized.
- E-signature or electronic acceptance evidence.

**Advanced integrations**

- Account verification, automated settlement reports, refund/distribution payment files.
- Sanctions/PEP/risk screening.
- ERP/accounting export.
- Partner APIs with API keys/OAuth, scopes, quotas, webhooks, sandbox, and developer documentation.
- OpenSearch or advanced search.

**Agent AI tasks**

- Implement provider adapter interfaces, sandbox mocks, callback security, idempotency, contract tests, and operational runbooks.
- Generate partner API docs and integration test suites.

**Exit gate**

- Provider callbacks are authenticated, replay-protected, monitored, reconcilable, and manually recoverable during outages.

---

## Phase 15: Governed AI Assistance and Intelligent Automation

**Goal:** Add AI safely after authoritative workflows exist.

**Safe initial AI features**

- Project-plan completeness review.
- Offer/document summarization with citations.
- KYC document classification and extraction suggestions.
- Duplicate document and anomaly suggestions.
- Voucher narration/account category suggestions.
- Reconciliation match recommendations.
- Complaint classification and draft response.
- Management report narrative from approved metrics.
- Developer/test/documentation/review agents for engineering acceleration.

**Advanced AI features**

- Explainable project risk indicators.
- Cash-flow and budget-variance forecasts.
- Fraud/anomaly detection with case creation.
- Milestone-delay prediction.
- Personalized project discovery from declared preferences, not undisclosed financial advice.
- Natural-language query over authorized read models.

**AI governance**

- Model inventory, owner, purpose, version, provider, approval, and data classification.
- Prompt/version management and evaluation datasets.
- RAG only from authorized, versioned content with tenant/project filters.
- PII redaction, prompt-injection protection, output filtering, cost limits, rate limits, audit logs, and kill switch.
- Citations, confidence/uncertainty indicators, and human-review markers.
- No autonomous KYC rejection, voucher posting, project publication, fund release, refund, distribution approval, or financial advice.

**Agent AI tasks**

- Build AI gateway, prompt registry, retrieval authorization, evaluation harness, output audit, and human-review queues.
- Add safety tests for leakage, jailbreaks, hallucinations, and cross-tenant retrieval.

**Exit gate**

- AI features meet documented accuracy/safety thresholds, fail closed to non-AI process, and show source/citation/human-review status.

---

## Phase 16: Enterprise Multi-Tenancy, White Label, Scale, and Billing

**Goal:** Support multiple institutions and higher transaction volume.

**Basic enterprise features**

- Tenant-specific brand, domain, language, roles, workflows, fees, document templates, notification templates, reports, and integrations.
- Central platform operator plus tenant administrators.
- Tenant onboarding, configuration validation, suspension, export, and closure.
- Subscription plans, usage metering, billing, plan limits, and enterprise contracts.

**Advanced enterprise features**

- SSO/SAML/OIDC and automated user provisioning.
- Tenant-specific chart of accounts, retention policy, encryption keys, reporting policy, and data residency.
- Stronger isolation by schema/database for high-assurance deployments.
- Read replicas, reporting read models, table partitioning, cache strategy, archival, and disaster recovery.
- Selective service extraction for payment, notification, document, reporting, or AI modules when metrics justify it.

**Agent AI tasks**

- Implement tenant configuration, billing/metering, SSO adapters, isolation tests, and scaling migrations.
- Generate load, resilience, backup/restore, offboarding, and tenant export tests.

**Exit gate**

- Tenant isolation penetration test passes, load/resilience targets pass at 2-3x projected peak, and backup/export/offboarding are proven.

---

## Phase 17: Optional Regulated and Advanced Business Capabilities

**Goal:** Expand only after market validation and explicit regulatory approval.

**Optional capabilities**

- Donation and reward campaigns separated from investment accounting.
- Equity, cap table, shareholder register, voting, dividends, and corporate actions.
- Debt/P2P schedules, installments, arrears, restructuring, collections, and default.
- Secondary transfer marketplace.
- Insurance/guarantee administration.
- Valuation and impairment workflows.
- Multi-currency and exchange gains/losses.
- Cross-border investor tax/compliance.
- Institutional portfolios and bulk orders.
- Open banking, treasury automation, governed BI warehouse, regulatory reporting.
- ESG/impact metrics and assurance.

**Required pre-work**

- Separate legal, accounting, security, data, product, operational, and regulatory impact assessment.
- Separate product flags, terms, ledgers, reports, workflows, and disclosures.

**Exit gate**

- Written approvals and pilot-specific controls exist before implementation is exposed to users.

---

## 5. Release Roadmap

| Release | Phases | Outcome |
|---|---|---|
| R0 Prototype | 0-1 | Legal/accounting definition, UX prototype, architecture baseline, vertical slice |
| R1 Internal Alpha | 2-4 | Staff access, project administration, investor/KYC administration |
| R2 Controlled Funding Beta | 5-7 | Marketplace, commitments, payments, reconciliation, accounting |
| R3 Pilot Operations | 8-12 | Budgets, milestones, fund release, P&L, distributions, dashboards, compliance |
| R4 Mobile Commercial | 13-14 | Mobile app and automated integrations |
| R5 Intelligent Enterprise | 15-16 | Governed AI, white label, scale, SSO, billing |
| R6 Regulated Expansion | 17 | Approved additional models only |

**Estimated web-first controlled pilot:** 8-12 months, depending on legal decisions, integrations, accounting complexity, and UAT readiness.

---

## 6. Prioritized Backlog

### P0: Controlled Pilot Must-Haves

- Legal model, accounting policy, posting matrix, role/approval matrix.
- Identity, MFA, organization, roles, assignments, approval limits, audit.
- Project sponsor, due diligence, offer publication, documents, risks, milestones.
- Investor registration, KYC, offline capture, approval, bank account, nominee, consent.
- Marketplace, disclosures, suitability, commitment, agreement acceptance.
- Bank-reference payment, statement import, reconciliation, allocation, receipt, refund.
- Double-entry project accounting, vouchers, period close, trial balance, P&L, cash flow.
- Budget, procurement basics, milestone evidence, controlled fund release.
- Investor, project, accounts, admin dashboards.
- Documents, notifications, complaints, reports, exports.
- Security, backup, monitoring, runbooks, UAT, penetration test.

### P1: First Commercial Improvements

- Payment/KYC integrations.
- Mobile investor app.
- Advanced procurement/assets.
- Automated distribution payment.
- Compliance rule engine.
- Scheduled reports and enhanced analytics.
- Enterprise SSO and white-label basics.

### P2: Growth and Intelligence

- AI assistants and anomaly recommendations.
- Data warehouse and portfolio forecasting.
- Multi-tenant enterprise billing.
- Partner API ecosystem.
- Sector templates, ESG/impact metrics, institutional portfolios.

### P3: Regulatory Expansion Only

- Equity, debt, secondary transfer, cross-border, multi-currency, tokenization, or other regulated products.

---

## 7. Mandatory Quality Gates

- Domain glossary, state machines, API contracts, and ADRs approved.
- Tenant/project isolation enforced in app and database constraints.
- Authorization matrix and negative access tests pass.
- Financial postings balance; posted vouchers are immutable.
- Payment callback and posting operations are idempotent.
- Investor ledgers reconcile to control accounts and GL.
- Period close, reversal, refund, distribution, and project closure pass accountant validation.
- KYC/AML, holds, complaints, and suspicious cases pass compliance UAT.
- SAST, SCA, secret scan, dependency scan, container scan, and penetration test pass or have approved exceptions.
- Backup restore, DR, incident response, and reconciliation runbooks are tested.
- Dashboards and reports show freshness, source, as-of date, and export audit.
- AI features have evaluation thresholds, citations, redaction, audit, and human-review workflow.

---

## 8. First 12 Agent AI Epics

1. Repository, CI/CD, observability, environment, architecture tests.
2. Organization, users, RBAC/ABAC, MFA, sessions, audit.
3. Sponsor, project, due diligence, offer versioning, documents.
4. Investor profile, KYC, bank account, nominee, consent, assisted onboarding.
5. Marketplace, project comparison, disclosure, watchlist.
6. Commitment, suitability, agreement, limits, eligibility.
7. Payment reference, statement import, reconciliation, allocation, receipt, refund.
8. Chart of accounts, fiscal periods, vouchers, posting, reversal, ledger reports.
9. Budget, procurement, expenses, vendors, assets, milestones.
10. Period close, P&L, distribution calculation, payable, payment, statement.
11. Dashboards, reports, notifications, complaints, risk, audit portal.
12. Security hardening, performance, resilience, UAT, migration, pilot launch.

Each epic must be decomposed into vertical slices that keep the system deployable and testable.

---

## 9. Pilot Launch Checklist

- Written legal opinion and approved operating model.
- Approved project, investor, privacy, risk, complaint, fee, and contract documents.
- Three to five completed project due-diligence files.
- Project-specific financial segregation and bank/payment controls.
- Accountant-approved posting matrix and report reconciliation.
- KYC/AML procedure and trained compliance staff.
- Maker-checker/limits tested for all sensitive actions.
- Security review, penetration test, backup restore, and incident drill.
- UAT signed by Product, Finance, Compliance, Operations, and Security.
- Production monitoring, on-call, escalation, support, and reconciliation runbooks.
- Investor education and explicit non-guaranteed-return disclosure.
- Controlled user/transaction limits and rollback/suspension authority.

---

## 10. Immediate Next 90 Days

### Days 1-30

- Select initial funding model and target pilot sector.
- Engage legal, accounting, compliance, and security reviewers.
- Interview sponsors and investors.
- Define due-diligence, accounting, profit/loss, distribution, complaint, and refund policies.
- Select anchor sponsor and candidate pilot projects.

### Days 31-60

- Finalize BRD, SRS, role/approval matrix, domain glossary, and state machines.
- Create UX wireframes and clickable prototype.
- Approve architecture, ERD, security model, integration choices, and data classification.
- Prepare legal documents, risk disclosures, privacy notices, and templates.
- Establish pilot KPIs, team plan, delivery backlog, and CI/CD foundation.

### Days 61-90

- Start core MVP vertical slices.
- Configure pilot chart of accounts and accounting test cases.
- Build project disclosure content and sponsor onboarding pipeline.
- Prepare infrastructure, test automation, monitoring, backup, and security checks.
- Schedule controlled UAT and launch-readiness checkpoints.
