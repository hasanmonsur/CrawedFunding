# CrowdFund360
## Agent AI–Ready Technical Blueprint and Phase-by-Phase Solution Development Plan

**Version:** 1.0  
**Target market:** Bangladesh-first, region-ready  
**Delivery model:** Agent AI-assisted development with mandatory human architecture, accounting, security, legal, and release approvals  
**Architecture:** Modular monolith first; event-driven integrations; independently extractable modules  
**Primary stack:** React/Next.js, React Native, Node.js/NestJS, PostgreSQL, Redis, S3-compatible object storage

> This plan translates the approved CrowdFund360 business blueprint into an implementation-ready program. It covers basic through advanced business features, engineering controls, AI-agent work packages, testing, deployment, and production operations.

---

## 1. Product Goal

Build a secure multi-project crowdfunding and investment-administration platform in which:

- An organization can declare and manage many projects.
- Every project has independent plans, budgets, ledgers, P&L, cash flow, documents, investors, risks, milestones, and dashboards.
- One investor can invest in multiple projects and receive a separate investor-project ledger for each investment.
- Project managers record operations and accounting entries.
- Account managers check entries and reconcile financial activity.
- Authorized officers approve vouchers, refunds, releases, and distributions.
- Administrators manage the full portfolio and assign responsible officers.
- Compliance teams control KYC, AML, source of funds, risk, and suspicious activities.
- Auditors can trace every business and financial action without changing records.

### Mandatory legal boundary

The software must support configurable crowdfunding models, but no public fundraising, securities offering, lending, deposit-taking, payment custody, or guaranteed-return product may be activated until the selected operating model has written legal and regulatory approval.

---

## 2. Delivery Principles for Agent AI

AI agents may design, generate, test, document, review, and refactor code. They must not independently approve business policies, financial formulas, compliance rules, security exceptions, production releases, or destructive data operations.

### Human approval gates

| Area | Required approver |
|---|---|
| Business scope and acceptance criteria | Product Owner/Business Analyst |
| Accounting entries and financial reports | Chartered accountant/Finance SME |
| KYC, AML, investment model, contracts | Legal and Compliance Officer |
| Architecture and data model | Solution Architect |
| Security design and exceptions | Security Lead |
| Production deployment | Release Manager/Product Owner |
| Project publication and real fund flow | Authorized business officers |

### Agent working rules

1. Read the repository instructions, architecture decisions, domain glossary, and assigned specification before editing.
2. Work only on one bounded issue or work package at a time.
3. Produce a short implementation plan before code.
4. Never invent accounting, legal, KYC, tax, or profit-distribution rules.
5. Add or update tests with every behavioral change.
6. Run formatting, static analysis, unit tests, integration tests, and relevant security checks.
7. Never place credentials, real NID data, bank data, or production secrets in prompts, logs, fixtures, or source control.
8. Never modify a posted voucher; use approved reversal and correction workflows.
9. Never bypass maker–checker, approval limits, tenancy, or project isolation to make a test pass.
10. Submit changes through reviewable commits/PRs with evidence of validation.

---

## 3. Recommended Product Architecture

### 3.1 Initial deployment style

Use a modular monolith for the MVP. Each business domain must have separate NestJS modules, application services, domain objects, repositories, database schemas or strongly enforced tables, API contracts, and tests. Cross-module access occurs through defined service interfaces or domain events—not direct table manipulation.

### 3.2 Core applications

| Application | Users | Technology |
|---|---|---|
| Investor Web | Investors and applicants | Next.js/React, TypeScript |
| Operations Web | Project, accounts, compliance, admin, audit | Next.js/React, TypeScript |
| Investor Mobile | Investors | React Native, TypeScript |
| Backend API | All channels and integrations | NestJS, Node.js, TypeScript |
| Background Workers | Notifications, reconciliation, reports, distributions | NestJS workers/BullMQ |
| Reporting Store | Operational analytics and scheduled reporting | PostgreSQL read models initially |

### 3.3 Platform components

- PostgreSQL: source of truth for transactional and accounting data
- Redis: distributed cache, rate limits, job queues, OTP/session support
- S3-compatible storage: encrypted documents and media
- RabbitMQ or Redis/BullMQ: asynchronous jobs initially
- OpenSearch: advanced search in later phases
- OpenTelemetry: distributed traces and application telemetry
- Prometheus/Grafana: metrics and dashboards
- Centralized structured logs: application, security, audit, and integration events
- Secrets vault: keys and connection secrets
- Docker: reproducible development and deployment
- Kubernetes: optional when scale and operational capability justify it

### 3.4 Business modules

1. Identity and Access Management
2. Organization and Multi-Tenancy
3. Investor and KYC
4. Sponsor and Project Due Diligence
5. Project and Offer Management
6. Investment Commitment and Allocation
7. Payments and Reconciliation
8. Accounting and General Ledger
9. Budget and Procurement
10. Profit/Loss and Distribution
11. Milestone and Fund Release
12. Document and Agreement Management
13. Workflow and Approval
14. Risk, Compliance, and Case Management
15. Notification and Communication
16. Reporting, Dashboards, and Analytics
17. Complaints and Investor Service
18. Audit and Platform Administration
19. Integration and API Management
20. AI Assistance and Intelligence

---

## 4. Repository and Engineering Structure

```text
crowdfund360/
  apps/
    api/
    worker/
    investor-web/
    operations-web/
    investor-mobile/
  packages/
    domain-contracts/
    ui-components/
    validation/
    observability/
    test-fixtures/
    configuration/
  database/
    migrations/
    seeds/
    reference-data/
  infrastructure/
    docker/
    kubernetes/
    terraform/
    monitoring/
  docs/
    business/
    architecture/
    api/
    accounting/
    security/
    operations/
    adr/
  tests/
    e2e/
    performance/
    security/
```

### Required repository documents

- `README.md`: setup, commands, environments, and contribution flow
- `AGENTS.md`: AI-agent scope, commands, constraints, and review rules
- `docs/DOMAIN_GLOSSARY.md`: approved business vocabulary
- `docs/REQUIREMENTS_TRACEABILITY.md`: requirement → story → API → test mapping
- `docs/architecture/SYSTEM_CONTEXT.md`
- `docs/architecture/MODULE_BOUNDARIES.md`
- `docs/architecture/DATA_CLASSIFICATION.md`
- `docs/accounting/ACCOUNTING_POLICY.md`
- `docs/security/THREAT_MODEL.md`
- `docs/security/SECURE_CODING.md`
- `docs/api/openapi.yaml`
- ADRs for every material architectural decision

---

## 5. Environments and Delivery Pipeline

### Environments

1. Local development
2. Shared development
3. Automated test/integration
4. UAT
5. Pre-production/staging
6. Production
7. Disaster-recovery environment, when required

### CI quality gates

- Dependency installation from locked versions
- Formatting and linting
- Type checking
- Unit tests and coverage thresholds
- Database migration validation
- API contract tests
- Integration tests with ephemeral PostgreSQL/Redis
- SAST, secret scan, dependency/SBOM scan, and container scan
- Build signed immutable artifacts
- Deploy automatically to development; controlled promotion to UAT/staging
- Manual approval and change record for production

### Branch and release strategy

- Trunk-based development with short-lived feature branches
- Protected main branch and mandatory pull-request reviews
- Semantic versioning for APIs and releases
- Feature flags for incomplete/high-risk functionality
- Expand/contract database migration strategy
- Automated rollback for application release; controlled forward-fix for irreversible migrations

---

# Phase-by-Phase Development Plan

## Phase 0 — Business, Legal, and Accounting Definition

**Duration:** 4–6 weeks  
**Objective:** Remove business ambiguity before software construction.

### Features and decisions

- Select initial model: invitation-only profit sharing or revenue sharing, subject to legal approval.
- Define investor types, eligibility, limits, project types, risk bands, and offer states.
- Define project lifecycle, funding threshold, overfunding, cancellation, refund, default, closure, and material-change processes.
- Define KYC, AML, source-of-funds, beneficial ownership, PEP/sanctions, and document-retention policies.
- Define chart of accounts, voucher types, approval limits, period close, corrections, reserves, P&L, loss carry-forward, tax, and distribution policy.
- Define platform fees and accounting treatment.
- Define complaints, disputes, voting/consent, privacy, and data retention.

### Technical work

- Produce domain glossary and context map.
- Build requirements traceability matrix.
- Model business state machines and exception paths.
- Create initial threat model and data-classification register.
- Select build, hosting, KYC, bank/payment, SMS/email, and document-storage options.

### AI-agent work packages

- Convert approved policies into user stories and acceptance criteria.
- Generate process diagrams, state tables, role-permission matrix, and exception catalogue.
- Generate initial OpenAPI resource catalogue without implementation.
- Identify contradictions, missing decisions, and edge cases for human resolution.

### Deliverables

- Business Requirements Document
- Software Requirements Specification
- Accounting Policy and posting matrix
- Role/approval matrix
- Legal/compliance requirements register
- Prioritized product backlog
- MVP scope and explicit exclusions

### Exit gate

No implementation starts until Product, Finance, Legal/Compliance, Architecture, and Security approve the baseline.

---

## Phase 1 — UX, Architecture, and Engineering Foundation

**Duration:** 4–6 weeks  
**Objective:** Create a secure and testable product foundation.

### UX deliverables

- Bangla/English design system
- Responsive investor and operations navigation
- Accessibility, empty, loading, validation, error, offline, and permission states
- Clickable prototype for registration, KYC, project discovery, investment, vouchers, and dashboards
- Standard financial tables and downloadable report layouts

### Platform features

- Monorepo, linting, formatting, type checking, test frameworks, CI/CD
- Application configuration and secrets abstraction
- Structured logging, correlation IDs, health/readiness endpoints
- Error-handling standard and API response envelope
- Database migrations, seeding, transaction wrapper, and audit metadata
- Base UI component library and localization framework
- Feature flags and environment configuration

### Architecture deliverables

- System context, container, module, deployment, trust-boundary, and data-flow diagrams
- ERD and data ownership map
- API versioning, pagination, idempotency, concurrency, and error standards
- ADRs for modular monolith, PostgreSQL, Redis, object storage, authentication, and outbox events

### Exit gate

- A sample vertical slice works from UI through API to PostgreSQL.
- CI blocks defective builds.
- Logs and traces correlate one request across components.
- Architecture and threat-model review passes.

---

## Phase 2 — Identity, Organization, Roles, and Audit Foundation

**Duration:** 4–5 weeks  
**Objective:** Establish secure access and segregation of duties.

### Basic features

- User registration/invitation and verified mobile/email
- Login, logout, password reset, OTP, session and device management
- Mandatory MFA for privileged users
- Organization/tenant setup
- Roles: Investor, Project Manager, Account Manager, Voucher Authorizer, Compliance Officer, Project Administrator, Auditor, Super Administrator
- User activation, suspension, lock, expiry, and access review
- Project-scoped assignments and amount-based approval limits
- Menu, API, data, and action permissions
- Audit events for authentication, authorization, data changes, exports, and approvals

### Advanced controls

- RBAC plus attribute checks for tenant, project, role, status, and monetary limit
- Delegation with effective date and expiry
- Conflict-of-interest declaration
- Four-eyes rule: creator cannot finally approve controlled action
- Step-up authentication for sensitive actions
- Break-glass access with reason, time limit, and alert

### Key entities

Organization, User, Role, Permission, UserRole, ProjectAssignment, ApprovalLimit, Session, Device, Delegation, AuditEvent.

### Exit gate

- Automated authorization matrix tests pass.
- Cross-tenant and cross-project access tests fail securely.
- Security Lead approves IAM and audit controls.

---

## Phase 3 — Project Sponsor, Due Diligence, and Project Management

**Duration:** 6–8 weeks  
**Objective:** Manage the complete project declaration and approval lifecycle.

### Basic project features

- Sponsor registration and business profile
- Project draft, submit, review, approve, publish, pause, reject, cancel, close
- Project manager/account manager/compliance assignment
- Category, sector, location, legal entity, team, and contact information
- Funding target, minimum threshold, maximum cap, duration, opening/closing date
- Minimum/maximum investment and investment unit
- Business plan, use of funds, revenue model, budgets, forecasts, break-even, risks, and exit plan
- Milestones, deliverables, evidence, schedule, and progress percentage
- Image, video, document, license, valuation, and financial-statement upload

### Due-diligence features

- Configurable checklist and evidence requirements
- Sponsor ownership, directors, beneficial owners, licenses, litigation, assets, contracts, insurance, and tax information
- Review comments, findings, remediation, and sign-off
- Risk score across sponsor, market, finance, execution, legal, liquidity, and governance
- Independent reviewer for high-risk/high-value projects
- Versioned published offer; investors retain the exact version accepted

### Advanced project features

- Conservative/base/optimistic forecast scenarios
- Sensitivity analysis and assumption register
- Dependencies, related parties, conflicts, covenants, and guarantees
- Project health score using finance, schedule, risk, and compliance
- Material-change workflow requiring reapproval and investor notice/consent
- Project templates by sector

### Exit gate

- A complete pilot project moves from draft to approved publication.
- Every published field and document is versioned and auditable.
- Unapproved projects cannot accept commitments.

---

## Phase 4 — Investor Registration, KYC, AML, and Service Profile

**Duration:** 6–8 weeks  
**Objective:** Onboard investors through online and controlled offline channels.

### Basic features

- Individual and institutional profiles
- Self-registration and authorized assisted/offline registration
- Mobile/email OTP verification
- NID/passport, photo, address, date of birth, occupation, income band, tax information
- Institutional registration, registration documents, directors, and beneficial owners
- Bank account, nominee/beneficiary, and emergency contact
- Consent, privacy notice, risk acknowledgement, and terms acceptance
- Document upload, preview, replace, verify, reject, and expiry
- KYC states: Draft, Submitted, Under Review, Information Required, Approved, Rejected, Expired, Suspended
- KYC reviewer queue and SLA

### Advanced compliance features

- Source-of-funds and source-of-wealth declarations
- Duplicate detection across identity, mobile, email, bank account, device, and address
- PEP/sanctions/provider screening when authorized
- Risk-based enhanced due diligence
- Periodic review and expiring-document alerts
- Suspicious-activity case and controlled account hold
- Beneficial-ownership hierarchy for institutions
- Data subject requests and retention controls

### Offline onboarding controls

- Agent creates provisional record and scans documents.
- Investor receives confirmation through a verified channel.
- No investment allocation occurs before required approval.
- Capture agent, location, timestamp, evidence, and investor acknowledgement.

### Exit gate

- Approved, rejected, information-required, expired, duplicate, and suspicious cases pass UAT.
- Compliance Officer approves workflow and evidence retention.

---

## Phase 5 — Project Marketplace, Offer Disclosure, and Investment Commitment

**Duration:** 5–7 weeks  
**Objective:** Let eligible investors discover, assess, and commit to projects.

### Marketplace features

- Project list/detail, sector/location/model/risk/status filters
- Search, sort, watchlist, compare, and share
- Funding progress, days remaining, minimum investment, risk, fees, and status
- Business plan, use of funds, revenue plan, forecast, milestones, sponsor, documents, updates, and FAQs
- Standardized disclosures and prominent risk warnings

### Commitment workflow

- Eligibility, KYC, project status, investor limit, and concentration checks
- Suitability questionnaire and risk acknowledgement
- Investment amount/unit selection
- Fee and net amount calculation
- Agreement generation and electronic acceptance
- Commitment reservation with expiry
- Cooling-off/cancellation when required
- States: Draft, Reserved, Awaiting Payment, Paid, Allocated, Cancelled, Expired, Refunded, Rejected

### Advanced features

- Waitlist and controlled oversubscription
- Investor class and project-specific limits
- Related-party and concentration warnings
- Material-change re-consent
- Offer analytics without revealing sensitive investor identity

### Exit gate

- One approved investor can commit to multiple projects.
- The accepted offer/agreement versions cannot change retrospectively.
- Limits and eligibility are enforced at API and database levels.

---

## Phase 6 — Payments, Bank References, Escrow, and Reconciliation

**Duration:** 6–10 weeks; integration-dependent  
**Objective:** Record, verify, allocate, refund, and reconcile funds safely.

### MVP payment features

- Unique project/investor/commitment payment reference
- Manual bank-transfer instruction and proof upload
- Authorized transaction-statement import
- Payment recording, checking, matching, rejection, and reversal
- Official receipt only after cleared/reconciled payment
- Partial payment, overpayment, underpayment, duplicate, unmatched, returned, and failed states
- Refund proposal and maker–checker authorization

### Integrated payment features

- Payment gateway, bank API, card, mobile financial service, or BanglaQR where legally approved
- Signed webhooks/callbacks, timestamp/nonce validation, and replay protection
- Idempotency key for initiation, callback, allocation, refund, and receipt
- Partner settlement report ingestion
- Escrow/trust or segregated project-account support where required

### Reconciliation engine

- Match on reference, amount, date, payer, account, and status
- Exact, probable, split, aggregate, and manual matching
- Unmatched and exception queues with SLA
- Daily opening + inflow − outflow = closing controls
- Reconciliation approval and lock

### Exit gate

- Replayed callback cannot duplicate funds or ledger entries.
- Payment totals reconcile to allocations and the general ledger.
- Refund requires separate authority and complete evidence.

---

## Phase 7 — Core Double-Entry Project Accounting

**Duration:** 8–12 weeks  
**Objective:** Deliver complete, independent, auditable accounts for every project.

### Accounting foundation

- Organization and project chart of accounts
- Fiscal year and accounting periods
- Journal, receipt, payment, contra, purchase, sales, accrual, adjustment, depreciation, refund, fund-release, and distribution vouchers
- Voucher header and balanced debit/credit lines
- Project, cost center, milestone, vendor, investor, bank, and document dimensions
- Draft → Submitted → Checked → Authorized → Posted workflow
- Return for Correction, Reject, Reverse, and Replace with Corrected Voucher
- Amount-based approval authority and segregation of duties
- Period lock and controlled reopening

### Subsidiary ledgers

- Investor capital/liability and investor-project sub-ledger
- Cash and bank book
- Accounts receivable and payable
- Vendor and sponsor ledgers
- Fixed assets and depreciation
- Advances, prepayments, accruals, withholding tax, reserves, and platform fees

### Reports

- Journal and general ledger
- Trial balance
- Cash book and bank book
- Income statement/P&L
- Balance sheet/statement of financial position
- Cash-flow statement
- Fund-utilization statement
- Receivable/payable aging
- Investor ledger and control-account reconciliation
- Project consolidation without merging underlying ledgers

### Technical invariants

- Posted voucher total debit equals total credit.
- Every financial line has immutable organization and project scope.
- Cross-project posting is blocked except an explicit approved transfer workflow.
- Posted vouchers cannot be edited or deleted.
- Reversal preserves the original and creates opposite entries.
- Money uses fixed-precision decimal/numeric types—never floating point.
- Posting is atomic and idempotent.
- Report totals reconcile to the same posting source.

### AI-agent safety

Agents generate posting-rule tests from an accountant-approved posting matrix. Agents may not infer missing debit/credit rules or change formulas without Finance SME approval.

### Exit gate

- Accountant signs off posting examples and financial reports.
- Investor sub-ledger reconciles with the control account.
- Project A data cannot appear in Project B statements.
- Period close, reversal, correction, and reopening scenarios pass.

---

## Phase 8 — Budget, Procurement, Expenses, Assets, and Project Operations

**Duration:** 6–8 weeks  
**Objective:** Control use of invested funds against project plans.

### Budget features

- Versioned annual/project/milestone budget
- Account, cost center, work package, vendor, and period allocation
- Budget approval, revision, transfer, freeze, and supplementary budget
- Actual, committed, available, and forecast-at-completion
- Variance thresholds and alerts

### Procurement and expense features

- Purchase requisition, quotation comparison, purchase order, goods/service receipt, invoice, payment request
- Vendor onboarding and bank-detail verification
- Expense claim and petty cash
- Three-way matching where applicable
- Procurement and payment approval limits
- Related-party/conflict declaration

### Asset/inventory features

- Asset registration, category, custodian, location, depreciation, disposal
- Basic inventory receipt, issue, balance, adjustment, and valuation where projects require it

### Exit gate

- No expense can exceed policy without an approved exception.
- Procurement documents link to resulting voucher and payment.
- Dashboard accurately reports budget vs actual vs commitment.

---

## Phase 9 — Milestone-Based Fund Release and Project Monitoring

**Duration:** 4–6 weeks  
**Objective:** Release and track project funds based on verified progress.

### Features

- Milestone definition, amount, due date, dependencies, evidence, and acceptance criteria
- Project manager progress submission
- Technical/financial/compliance review
- Site-visit or third-party verification record
- Release proposal, multi-level approval, payment, and accounting posting
- Partial approval, hold, rejection, resubmission, and cancellation
- Schedule and cost variance
- Delay, budget overrun, covenant breach, and evidence-expiry alerts
- Project update publication to investors

### Advanced monitoring

- Earned-value indicators where useful
- Photo/document metadata verification
- Health score and red/amber/green status
- Corrective-action plan and escalation
- Investor consent for defined material deviations

### Exit gate

- Fund release cannot exceed cleared funding, approved budget, or milestone authority.
- Every release has evidence, approvals, payment record, and balanced posting.

---

## Phase 10 — Profit/Loss Close and Investor Distribution

**Duration:** 7–10 weeks  
**Objective:** Calculate and pay investor entitlements transparently.

### Period-close features

- Reconciliation completion checklist
- Accrual, prepayment, depreciation, inventory, impairment, tax, and reserve entries
- Preliminary P&L → review → adjustment → approval → period lock
- Independent/audit review marker

### Distribution engine

- Accountant-approved formula versioning
- Gross project result, allowable costs, taxes, prior losses, reserves, sponsor share, platform fee, and distributable amount
- Pro-rata calculation by verified unit, capital, approved holding period, or contractual rule
- Investor eligibility and bank/KYC status validation
- Distribution proposal, simulation, exceptions, approval, and lock
- Investor payable accounting before payment
- Payment batch/API, failed/returned/held/reissued status
- Withholding tax, advice, statement, and reconciliation

### Loss and closure features

- Loss carry-forward under approved policy
- Capital impairment disclosure
- Project default/insolvency workflow
- Final realization, settlement, distribution/refund, and project closure

### Exit gate

- Distribution calculation is reproducible from a locked ledger and formula version.
- Sum of investor entitlements plus approved residual equals distributable amount.
- Payments reconcile with investor payables and bank transactions.

---

## Phase 11 — Dashboards, Reports, Documents, and Notifications

**Duration:** 6–8 weeks  
**Objective:** Provide live visibility and legally useful records.

### Investor dashboard

- Total invested, project allocation, commitments, cleared capital, units/share basis
- Paid/pending distributions, realized results, statements, receipts, agreements
- Project milestones, updates, risks, material changes, and required actions
- KYC, nominee, bank account, preferences, requests, and complaints

### Project dashboard

- Target, committed, collected, cleared, allocated, released, and remaining
- Investor count and concentration
- Budget, actual, commitment, available, forecast
- Revenue, expense, margin, P&L, cash, receivables, payables, and runway
- Milestones, schedule, risks, exceptions, distributions, and documents

### Administrator dashboard

- Cross-project portfolio, project health, funding and financial performance
- KYC pipeline, investor growth, concentration, complaints, and service levels
- Unapproved vouchers, reconciliation breaks, overdue tasks, and compliance alerts
- Platform fee and recurring-revenue reports

### Reports and export

- Parameterized, authorized PDF/Excel/CSV reports
- Scheduled report delivery with masking and expiry
- Report version, criteria, generated-by, generated-at, and checksum
- As-of-date and period-based reporting

### Document management

- Version, classification, owner, project, investor, expiry, retention, access, watermark
- Agreement templates and merge fields
- Electronic acceptance/e-signature evidence
- Malware scan and content-type validation

### Notifications

- SMS, email, push, in-app
- Template, language, preference, delivery status, retry, and suppression
- Critical events cannot be disabled where law/policy requires notice

### Exit gate

- Dashboard values reconcile to source transactions.
- Unauthorized exports are blocked and logged.
- Notifications are idempotent and traceable.

---

## Phase 12 — Complaints, Risk, Compliance, Governance, and Audit

**Duration:** 5–7 weeks  
**Objective:** Operationalize investor protection and enterprise control.

### Case management

- Investor complaint, dispute, fraud alert, suspicious activity, policy exception, audit finding
- Category, severity, project, owner, SLA, evidence, notes, communications, resolution, appeal
- Escalation and regulator/auditor export where authorized

### Risk and compliance

- Project and investor risk register
- Control library and control-testing schedule
- KYC refresh, screening refresh, document expiry, transaction monitoring
- Rule engine for high amount, rapid inflow/refund, duplicates, unusual patterns, related parties, and beneficiary changes
- Holds that block new commitments, refunds, releases, or distributions according to authority

### Audit portal

- Read-only, time-bound, project-scoped access
- Voucher, document, approval, reconciliation, user-access, configuration, and event history
- Evidence packages and audit sampling
- No deletion or modification by auditor role

### Exit gate

- End-to-end suspicious activity, complaint, hold, release, and audit-evidence scenarios pass.
- Every sensitive configuration change is approved and audited.

---

## Phase 13 — Mobile Applications and Assisted Operations

**Duration:** 8–12 weeks  
**Objective:** Extend safe investor and field operations to mobile.

### Investor mobile

- Registration, KYC, document capture, project discovery, comparison, commitment
- Payment instructions/status, receipts, portfolio, statements, distributions
- Project updates, push notifications, complaints, profile, bank/nominee requests
- Biometric app unlock, secure local storage, device binding, screenshot controls where appropriate

### Assisted/field app or responsive mode

- Offline draft capture with encrypted local storage
- Agent identity, location, timestamp, consent, and document quality checks
- Controlled synchronization and duplicate handling
- No offline final approval or fund allocation

### Exit gate

- Mobile APIs enforce the same authorization and business rules as web.
- Lost-device/session-revocation scenarios pass.
- Offline data is encrypted, minimal, expiring, and safely synchronized.

---

## Phase 14 — Advanced Integrations and API Ecosystem

**Duration:** 8–12 weeks per integration wave  
**Objective:** Connect institutions without weakening controls.

### Integration candidates

- Bank account verification and transaction APIs
- Approved payment/escrow providers
- NID/KYC/business verification
- PEP/sanctions/risk providers
- SMS/email/push/e-signature
- ERP/accounting export
- Tax/withholding interfaces
- Sponsor operational systems

### API platform features

- OAuth 2.0/OIDC, client credentials, mTLS where required
- API keys only for low-risk/server scenarios with rotation
- Scoped clients, quotas, rate limiting, IP restrictions
- Webhook registration, signing, retries, dead-letter queue, replay tools
- Partner sandbox, API documentation, test data, and certification
- Consent, purpose, data minimization, and field-level masking
- Versioning and deprecation policy

### Exit gate

- Partner certification tests pass.
- Reconciliation proves external and internal totals match.
- Outages, timeouts, duplicates, delayed callbacks, and replay scenarios pass.

---

## Phase 15 — AI Assistance and Intelligent Automation

**Duration:** Iterative after trusted core data exists  
**Objective:** Improve productivity and insight without allowing autonomous financial authority.

### Safe initial AI features

- Project plan completeness checker
- Summarization of approved project documents with citations
- Investor FAQ assistant grounded only in approved project/policy content
- KYC document classification and extraction with human verification
- Voucher narration/category suggestion—not posting
- Duplicate document and anomaly suggestions
- Management report narrative from approved metrics
- Complaint classification and draft response
- Developer/test agents for code generation, test creation, documentation, and defect analysis

### Advanced AI features

- Project risk indicators based on approved explainable features
- Cash-flow and budget-variance forecast
- Reconciliation match recommendation
- Fraud/anomaly detection with case creation
- Milestone-delay prediction
- Personalized project discovery based on declared preference—never undisclosed suitability advice
- Natural-language query over authorized read models

### AI governance

- Model inventory, purpose, owner, version, provider, data classification, and approval
- Prompt/version management and evaluation datasets
- RAG only from authorized, versioned content with project/tenant filters
- Output citations and uncertainty indicators
- Human review for KYC, risk, accounting, legal, investor communication, and financial actions
- No autonomous voucher approval, investor rejection, fund release, refund, distribution, or project recommendation represented as financial advice
- Prompt-injection protection, output filtering, PII redaction, audit logs, rate limits, cost controls, and kill switch
- Regular accuracy, bias, leakage, jailbreak, and hallucination evaluations

### Exit gate

- AI feature meets documented accuracy and safety threshold.
- Failure falls back to a non-AI business process.
- User can identify AI-generated content and request human review.

---

## Phase 16 — Enterprise Multi-Tenancy, White Label, and Scale

**Duration:** 10–16 weeks  
**Objective:** Support multiple institutions and higher transaction volume.

### Enterprise features

- Tenant-specific brand, domain, language, roles, chart of accounts, workflows, fees, documents, notifications, and integrations
- Central platform operator plus tenant administrators
- Data residency, retention, encryption key, and reporting policies by tenant
- Subscription, usage metering, billing, plan limits, and enterprise contracts
- SSO/SAML/OIDC and automated user provisioning where required
- Tenant onboarding, configuration validation, migration, suspension, export, and closure

### Scale evolution

- Read replicas and reporting read models
- Partition high-volume audit, journal, event, and notification tables
- Cache safe reference/configuration data
- Async jobs for documents, notifications, reports, and external calls
- Transactional outbox and inbox deduplication
- Extract payment, notification, document, reporting, or AI services only when metrics justify it
- Regional deployment and disaster recovery

### Exit gate

- Tenant isolation penetration test passes.
- Load and resilience targets pass at projected 2–3× peak.
- Tenant backup, export, recovery, and offboarding are proven.

---

## Phase 17 — Optional Advanced Business Capabilities

These are post-regulatory and post-market-validation features.

- Donation and reward campaigns separated from investment accounting
- Equity/cap table, shareholder registers, voting, dividend and corporate actions
- Debt schedules, installments, collections, arrears, restructuring, and default
- Secondary transfer/marketplace only with explicit legal permission
- Insurance/guarantee administration
- Project valuation and impairment workflows
- Multi-currency and exchange gains/losses
- Cross-border investor tax/compliance
- Institutional portfolios and bulk orders
- Open-banking data and automated treasury
- ESG/impact metrics and assurance
- Data warehouse, governed BI, regulatory reporting, and portfolio stress testing

Each optional capability requires a separate business, legal, accounting, security, data, and operational impact assessment.

---

## 6. Core State Machines

### Project

Draft → Due Diligence → Review → Approved → Published → Funding → Funded → Active → Distributing → Closing → Closed

Alternative states: Information Required, Paused, Rejected, Cancelled, Failed Funding, Defaulted.

### Investor KYC

Draft → Submitted → Under Review → Approved

Alternative states: Information Required, Rejected, Expired, Suspended.

### Investment

Draft → Reserved → Awaiting Payment → Paid → Reconciled → Allocated → Active → Settled/Closed

Alternative states: Expired, Cancelled, Rejected, Refunded, Written Down.

### Voucher

Draft → Submitted → Checked → Authorized → Posted

Alternative states: Returned, Rejected, Reversed.

### Distribution

Draft → Calculated → Reviewed → Approved → Payable Posted → Payment Submitted → Reconciled → Completed

Alternative states: Held, Partially Paid, Failed, Returned, Cancelled.

All transitions must be permission-controlled, validated, timestamped, reasoned, and audited.

---

## 7. Database and Data Integrity Blueprint

### Data conventions

- UUID/ULID primary identifiers; separate human-readable reference numbers
- UTC timestamps plus explicit business time zone
- `numeric(19,4)` or accountant-approved precision for monetary values
- ISO currency codes even if MVP uses BDT only
- Optimistic concurrency/version column on mutable aggregates
- Created/updated actor, time, source, and correlation ID
- Soft lifecycle status for business records; no soft-delete substitute for financial reversal

### Isolation and constraints

- Every tenant-owned table includes immutable `OrganizationId`.
- Every project-owned table includes immutable `ProjectId`.
- Composite foreign keys or database validation prevent cross-project references.
- Row-level security may supplement—not replace—application authorization.
- Voucher balance and posting rules enforced by transaction/application plus database constraints where practical.
- Unique idempotency keys by operation scope.
- Unique payment references and callback event IDs.

### Data lifecycle

- Classification: Public, Internal, Confidential, Restricted Financial/Identity
- Encryption at rest and in transit
- Field masking in UI, logs, exports, and non-production environments
- Retention and legal-hold policies
- Anonymized/synthetic test data
- Archival without breaking accounting/audit references

---

## 8. API Design Standards

- REST/JSON for business APIs; events for asynchronous integration
- OpenAPI-first contracts and generated clients where appropriate
- `/api/v1/...` versioning
- Standard problem details with business error codes
- Pagination, filtering, sorting, field selection, and safe search
- Idempotency header for money and workflow operations
- `ETag`/version for concurrency-sensitive updates
- Correlation ID for every request
- Explicit commands for approve, reject, post, reverse, reconcile, release, distribute—never generic status editing
- Sensitive responses use no-store caching and masking
- Webhooks are signed, replay-protected, retried, and deduplicated

### Example resource groups

- `/auth`, `/users`, `/roles`, `/organizations`
- `/investors`, `/kyc-cases`, `/bank-accounts`, `/nominees`
- `/sponsors`, `/projects`, `/offers`, `/milestones`, `/risks`
- `/commitments`, `/payments`, `/allocations`, `/refunds`
- `/accounts`, `/periods`, `/vouchers`, `/journals`, `/reconciliations`
- `/budgets`, `/vendors`, `/procurements`, `/assets`
- `/profit-calculations`, `/distributions`
- `/documents`, `/agreements`, `/notifications`, `/complaints`
- `/reports`, `/dashboards`, `/audit-events`, `/integrations`

---

## 9. Testing Strategy

### Test layers

| Layer | Purpose |
|---|---|
| Unit | Domain rules, calculations, authorization decisions, state transitions |
| Property-based | Accounting balance, allocation and distribution invariants |
| Integration | PostgreSQL, Redis, object storage, queues, transactions, outbox |
| Contract | API and partner request/response compatibility |
| Component | Module behavior with real database dependencies |
| E2E | Investor, project, voucher, payment, distribution, complaint journeys |
| Security | SAST, DAST, dependency, secret, access-control and tenant-isolation tests |
| Performance | API load, report jobs, reconciliation, posting and dashboard concurrency |
| Resilience | Timeout, retry, duplicate callback, queue failure, dependency outage |
| UAT | Business, accounting, compliance and operational acceptance |

### Mandatory financial test scenarios

- Balanced and unbalanced voucher
- Duplicate posting and idempotent retry
- Cross-project posting attempt
- Period lock and back-date attempt
- Reversal and corrected voucher
- Partial/over/underpayment and refund
- Investor ledger vs control-account reconciliation
- Distribution rounding and residual handling
- Failed/returned distribution payment
- Project loss and final closure

### Test data

- Synthetic persons, organizations, documents, payments, projects, and bank statements
- No copied production PII
- Seed packs for happy path, edge cases, fraud indicators, and accounting periods

---

## 10. Security and Privacy Verification

- Threat modeling per major phase
- OWASP ASVS-aligned verification target
- Authorization tests for every protected endpoint
- Tenant/project horizontal and vertical privilege tests
- MFA, session expiry, revocation, brute-force and recovery testing
- File malware/type/size validation
- SQL/NoSQL injection, XSS, CSRF, SSRF, deserialization, path traversal, and webhook replay tests
- Encryption/key rotation and secret-handling review
- PII discovery and log leakage test
- Backup encryption and restore test
- Independent penetration test before pilot and material releases
- Incident-response tabletop exercise

---

## 11. Observability and Production Operations

### Technical telemetry

- Request rate, error rate, latency, saturation
- Database connections, slow queries, locks, replication lag
- Cache hit rate and eviction
- Queue depth, age, retry and dead-letter counts
- External API availability and callback delay
- Document processing, report generation, notification delivery

### Business/control telemetry

- KYC queue and SLA breaches
- Funding, cleared payment, allocations and unmatched transactions
- Voucher queues, posting failures and period status
- Reconciliation breaks
- Budget overruns and milestone delays
- Distribution holds/failures
- Complaints, suspicious cases and project health

### Operational runbooks

- User lockout and privileged access recovery
- Payment callback outage and manual reconciliation
- Duplicate/incorrect transaction containment
- Queue backlog recovery
- External provider outage
- Security incident and suspected data breach
- Database failover and point-in-time recovery
- Backup restore and disaster recovery
- Project suspension, payment hold and emergency investor communication

---

## 12. Definition of Ready for an Agent Task

An AI coding agent may start only when the issue contains:

- Business purpose and actor
- In-scope and out-of-scope behavior
- Preconditions, main flow, exceptions, and postconditions
- Permission and project/tenant scope
- Data fields and validation rules
- State transitions
- Accounting entries, if applicable, approved by Finance
- API/UI expectations
- Audit and notification requirements
- Acceptance criteria and test examples
- Dependencies and feature flag

---

## 13. Definition of Done

- Acceptance criteria satisfied
- Code follows module boundaries and repository standards
- Unit/integration/E2E tests updated and passing
- Authorization and project/tenant isolation tested
- Accounting invariants tested when financial data is affected
- API documentation and migrations updated
- Audit, logging, metrics, and error handling included
- Security and dependency scans pass or approved exception exists
- No secrets or real personal data included
- UX includes loading, empty, error, permission, and accessibility states
- Human domain review completed where required
- Release/rollback note and operational impact documented

---

## 14. Standard Agent AI Work-Package Prompt

Use the following template for every implementation issue:

```text
ROLE
Act as a senior engineer working within the CrowdFund360 architecture.

CONTEXT
Module:
Business capability:
Relevant specifications/ADRs:
Affected roles:
Tenant/project scope:

OBJECTIVE
Implement one bounded capability only.

BUSINESS RULES
- List approved rules exactly.
- Do not infer missing accounting, legal, tax, KYC, or distribution rules.

SECURITY AND CONTROL
- Required permission:
- Maker/checker restriction:
- Approval limit:
- Audit events:
- Sensitive data handling:

DATA AND API
- Entities/fields:
- State transitions:
- Endpoints/events:
- Idempotency/concurrency rules:

ACCEPTANCE CRITERIA
Given/When/Then scenarios, including failures and boundary conditions.

TASK
1. Inspect existing code and constraints.
2. Present a concise implementation plan.
3. Implement the smallest complete vertical slice.
4. Add migrations and automated tests.
5. Run required checks.
6. Report changed files, validation evidence, risks, and unresolved questions.

PROHIBITIONS
- Do not bypass authorization, project isolation, approval workflow, or tests.
- Do not edit posted financial records.
- Do not add dependencies or change public contracts without approval.
- Do not use real PII or credentials.
```

---

## 15. Recommended AI Agent Roles

| Agent role | Responsibilities | Cannot approve |
|---|---|---|
| Product Agent | Stories, acceptance criteria, traceability, gap analysis | Business scope |
| Architecture Agent | ADR drafts, boundaries, dependency analysis | Architecture decision |
| Backend Agent | Domain/API/database implementation | Accounting/legal rules |
| Frontend Agent | Web UI, forms, accessibility, state handling | UX/business acceptance |
| Mobile Agent | React Native features and device controls | Mobile release |
| Test Agent | Test generation, regression, fixtures, coverage gaps | Test waivers |
| Security Agent | Threat review, scans, control recommendations | Risk acceptance |
| Data Agent | Migrations, performance, reporting queries | Destructive production changes |
| Documentation Agent | API, runbooks, user/admin guides | Policy content |
| Review Agent | Independent diff review and defect detection | Merge/release |

Use separate implementer and reviewer agents for high-risk modules, but require human approval for finance, compliance, security, and production.

---

## 16. Suggested Release Plan

| Release | Included phases | Business outcome |
|---|---|---|
| R0: Prototype | 0–1 | Validated journeys, architecture and policies |
| R1: Internal Alpha | 2–4 | Staff, projects, investor/KYC administration |
| R2: Controlled Funding Beta | 5–7 | Commitments, payments, reconciliation and accounting |
| R3: Pilot Operations | 8–12 | Budget, milestones, distributions, reporting, compliance |
| R4: Mobile Commercial | 13–14 | Mobile investors and automated integrations |
| R5: Intelligent Enterprise | 15–16 | Governed AI, white label and scale |
| R6: Regulated Expansion | 17 | Additional investment models after approval |

---

## 17. Indicative Timeline and Team

### Controlled pilot timeline

- Foundation and definition: 2–3 months
- Core alpha: 2–3 months
- Funding, accounting, and pilot operations: 3–4 months
- Assurance and controlled launch: 1–2 months

**Realistic web-first controlled pilot:** approximately 8–12 months, depending on legal decisions, integrations, and accounting complexity. Mobile, advanced AI, and enterprise features continue after pilot validation.

### Core team

- Product Owner/Business Analyst
- Solution Architect/Technical Lead
- Finance/Accounting SME
- Legal/Compliance Adviser
- 2 Backend Engineers
- 2 Web Frontend Engineers
- React Native Engineer after web foundation
- UI/UX Designer
- QA/Automation Engineer
- DevOps/Security Engineer
- Operations/Support Lead before pilot

AI agents increase throughput, but do not replace the named human accountabilities.

---

## 18. Prioritized MVP Backlog

### P0 — Required for controlled pilot

- Identity, MFA, organization, roles, assignments, audit
- Project/sponsor/due diligence/offer management
- Investor registration, KYC, offline capture, approval
- Marketplace, disclosure, commitment and agreement
- Bank-reference payment, reconciliation, allocation and receipt
- Double-entry project accounting and voucher workflow
- Budget, milestone, controlled fund release
- Period close, P&L and basic distribution
- Investor/project/admin dashboards
- Documents, notifications, complaints, reports
- Security, backup, monitoring, runbooks and UAT

### P1 — First commercial improvements

- Payment and KYC integrations
- Mobile investor app
- Advanced procurement/assets
- Automated distribution payment
- Compliance rule engine
- Scheduled reports and enhanced analytics
- Enterprise SSO and white-label basics

### P2 — Growth and intelligence

- AI assistants and anomaly recommendations
- Data warehouse and portfolio forecasting
- Multi-tenant enterprise billing
- Advanced API ecosystem
- Sector templates, ESG/impact and institutional portfolios

### P3 — Only after regulatory approval

- Equity, debt, secondary transfer, cross-border, multi-currency, tokenization, or other regulated products

---

## 19. Pilot Launch Checklist

- Written legal opinion and approved operating model
- Approved project, investor, privacy, risk, complaint and fee documents
- Three to five completed project due-diligence files
- Project-specific financial segregation and bank/payment controls
- Accountant-approved posting matrix and report reconciliation
- KYC/AML procedure and trained compliance staff
- Maker–checker/limits tested for all sensitive actions
- Security review, penetration test, backup restore, and incident drill
- UAT signed by Product, Finance, Compliance, Operations, and Security
- Production monitoring, on-call, escalation, support and reconciliation runbooks
- Investor education and explicit non-guaranteed-return disclosure
- Controlled user/transaction limits and rollback/suspension authority

---

## 20. First 12 Agent AI Epics

1. Repository, CI/CD, observability, and developer environment
2. Organization, user, RBAC/ABAC, MFA, and audit
3. Sponsor, project, offer, documents, and due diligence
4. Investor profile, KYC, bank account, nominee, and consent
5. Project discovery, comparison, disclosure, and watchlist
6. Investment commitment, agreement, limits, and eligibility
7. Payment reference, statement import, reconciliation, allocation, and receipt
8. Chart of accounts, periods, vouchers, posting, reversal, and ledger
9. Budget, procurement, expenses, assets, and milestones
10. P&L close, distribution calculation, payable, payment, and statement
11. Dashboards, reports, notifications, complaints, risk, and audit portal
12. Security hardening, performance, resilience, UAT, migration, and pilot launch

Each epic should be decomposed into vertical slices that leave the system deployable and testable.

---

## Conclusion

CrowdFund360 should be developed as a financial-control platform first and a crowdfunding marketplace second. The essential differentiators are independent project accounts, accurate investor-project ledgers, verified payment allocation, maker–checker authorization, transparent milestones, reproducible P&L and distribution calculations, and a complete audit trail.

Agent AI can accelerate requirements elaboration, code generation, testing, documentation, review, and operations. It must operate inside approved specifications and quality gates, while humans retain authority over business policy, accounting, compliance, security risk, and production fund movement.

