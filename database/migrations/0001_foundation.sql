-- CrowdFund360 foundation schema.
-- PostgreSQL is the authoritative store for transactional, financial, and audit data.

create schema if not exists identity;
create schema if not exists projects;
create schema if not exists investors;
create schema if not exists investments;
create schema if not exists payments;
create schema if not exists operations;
create schema if not exists accounting;
create schema if not exists audit;

create table if not exists identity.organizations (
  id uuid primary key,
  name text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists identity.users (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  display_name text not null,
  email text null,
  mobile text null,
  status text not null,
  mfa_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('Invited', 'Active', 'Suspended', 'Locked', 'Expired'))
);

create table if not exists identity.roles (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  name text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists identity.project_assignments (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid null,
  user_id uuid not null references identity.users(id),
  role_id uuid not null references identity.roles(id),
  effective_from timestamptz not null default now(),
  effective_to timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists identity.approval_limits (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  user_id uuid not null references identity.users(id),
  permission text not null,
  currency char(3) not null default 'BDT',
  max_amount numeric(19,4) not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz null,
  check (max_amount >= 0)
);

create table if not exists identity.sessions (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  user_id uuid not null references identity.users(id),
  token_hash text not null,
  status text not null,
  mfa_verified boolean not null default false,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  check (status in ('Active', 'Revoked', 'Expired', 'Locked'))
);

create table if not exists projects.projects (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  sponsor_id uuid null,
  title text not null,
  status text not null,
  currency char(3) not null default 'BDT',
  funding_target numeric(19,4) null,
  minimum_investment numeric(19,4) null,
  maximum_investment numeric(19,4) null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('Draft', 'Due Diligence', 'Information Required', 'Review', 'Approved', 'Published', 'Paused', 'Funding', 'Funded', 'Active', 'Distributing', 'Closing', 'Closed', 'Rejected', 'Cancelled', 'Failed Funding', 'Defaulted'))
);

create table if not exists projects.sponsors (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  legal_name text not null,
  sector text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists projects.due_diligence_items (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  label text not null,
  status text not null,
  evidence_document_id uuid null,
  completed_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('Pending', 'Completed', 'Remediation Required', 'Waived'))
);

create table if not exists projects.due_diligence_findings (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  item_id uuid not null references projects.due_diligence_items(id),
  severity text not null,
  note text not null,
  recorded_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  check (severity in ('Low', 'Medium', 'High'))
);

create table if not exists projects.risk_assessments (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  sponsor_score integer not null,
  market_score integer not null,
  finance_score integer not null,
  execution_score integer not null,
  legal_score integer not null,
  governance_score integer not null,
  average_score numeric(6,2) not null,
  band text not null,
  assessed_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  check (band in ('Low', 'Medium', 'High'))
);

create table if not exists projects.offer_versions (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  project_version integer not null,
  status text not null,
  snapshot jsonb not null,
  accepted_by_investors integer not null default 0,
  created_at timestamptz not null default now(),
  check (status in ('Published', 'Superseded', 'Withdrawn')),
  check (accepted_by_investors >= 0)
);

create table if not exists investors.investors (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  user_id uuid null references identity.users(id),
  investor_type text not null,
  full_name text not null,
  mobile text null,
  email text null,
  identity_fingerprint text null,
  occupation text null,
  income_band text null,
  source_of_funds text null,
  kyc_status text not null,
  hold_status text not null default 'None',
  hold_reason text null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (investor_type in ('Individual', 'Institutional')),
  check (kyc_status in ('Draft', 'Submitted', 'Under Review', 'Information Required', 'Approved', 'Rejected', 'Expired', 'Suspended')),
  check (hold_status in ('None', 'Compliance Hold', 'Payment Hold', 'Distribution Hold'))
);

create table if not exists investors.kyc_cases (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  investor_id uuid not null references investors.investors(id),
  status text not null,
  risk_rating text not null default 'Unrated',
  version integer not null default 1,
  updated_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('Draft', 'Submitted', 'Under Review', 'Information Required', 'Approved', 'Rejected', 'Expired', 'Suspended'))
);

create table if not exists investors.identity_documents (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  investor_id uuid not null references investors.investors(id),
  document_type text not null,
  document_ref text not null,
  status text not null,
  expires_at timestamptz null,
  created_at timestamptz not null default now(),
  check (document_type in ('identity', 'photo', 'address', 'bank', 'institutional', 'beneficial_owner')),
  check (status in ('Uploaded', 'Verified', 'Rejected', 'Expired'))
);

create table if not exists investors.bank_accounts (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  investor_id uuid not null references investors.investors(id),
  bank_name text not null,
  account_name text not null,
  account_fingerprint text not null,
  status text not null,
  created_at timestamptz not null default now(),
  check (status in ('Pending Verification', 'Verified', 'Rejected', 'Suspended'))
);

create table if not exists investors.nominees (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  investor_id uuid not null references investors.investors(id),
  full_name text not null,
  relationship text not null,
  mobile text null,
  created_at timestamptz not null default now()
);

create table if not exists investors.consents (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  investor_id uuid not null references investors.investors(id),
  consent_type text not null,
  version text not null,
  status text not null,
  created_at timestamptz not null default now(),
  check (status in ('Accepted', 'Withdrawn'))
);

create table if not exists investments.watchlist_items (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  investor_id uuid not null references investors.investors(id),
  project_id uuid not null references projects.projects(id),
  offer_version_id uuid not null references projects.offer_versions(id),
  created_at timestamptz not null default now(),
  unique (organization_id, investor_id, project_id, offer_version_id)
);

create table if not exists investments.suitability_records (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  investor_id uuid not null references investors.investors(id),
  project_id uuid not null references projects.projects(id),
  offer_version_id uuid not null references projects.offer_versions(id),
  answers jsonb not null,
  risk_acknowledged boolean not null,
  created_at timestamptz not null default now(),
  check (risk_acknowledged = true)
);

create table if not exists investments.commitments (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  investor_id uuid not null references investors.investors(id),
  project_id uuid not null references projects.projects(id),
  offer_version_id uuid not null references projects.offer_versions(id),
  accepted_offer_project_version integer not null,
  amount numeric(19,4) not null,
  currency char(3) not null default 'BDT',
  status text not null,
  expires_at timestamptz null,
  agreement_version text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount > 0),
  check (status in ('Draft', 'Reserved', 'Awaiting Payment', 'Paid', 'Reconciled', 'Allocated', 'Active', 'Expired', 'Cancelled', 'Rejected', 'Refunded', 'Written Down', 'Settled', 'Closed'))
);

create table if not exists payments.payment_instructions (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  investor_id uuid not null references investors.investors(id),
  commitment_id uuid not null references investments.commitments(id),
  payment_reference text not null,
  amount numeric(19,4) not null,
  currency char(3) not null default 'BDT',
  status text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, payment_reference),
  check (amount > 0),
  check (status in ('Issued', 'Matched', 'Cleared', 'Cancelled'))
);

create table if not exists payments.payment_proofs (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  investor_id uuid not null references investors.investors(id),
  commitment_id uuid not null references investments.commitments(id),
  instruction_id uuid not null references payments.payment_instructions(id),
  proof_document_ref text not null,
  paid_amount numeric(19,4) not null,
  currency char(3) not null default 'BDT',
  status text not null,
  created_at timestamptz not null default now(),
  check (paid_amount > 0),
  check (status in ('Submitted', 'Accepted', 'Rejected'))
);

create table if not exists payments.bank_transactions (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  transaction_ref text not null,
  payment_reference text not null,
  amount numeric(19,4) not null,
  currency char(3) not null default 'BDT',
  value_date date not null,
  status text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, transaction_ref),
  check (amount > 0),
  check (status in ('Imported', 'Matched', 'Exception'))
);

create table if not exists payments.reconciliations (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  commitment_id uuid not null references investments.commitments(id),
  bank_transaction_id uuid not null references payments.bank_transactions(id),
  status text not null,
  reason text null,
  created_at timestamptz not null default now(),
  check (status in ('Matched', 'Exception', 'Approved', 'Locked'))
);

create table if not exists payments.refunds (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  commitment_id uuid not null references investments.commitments(id),
  amount numeric(19,4) not null,
  currency char(3) not null default 'BDT',
  reason text not null,
  status text not null,
  proposed_by_user_id uuid not null,
  approved_by_user_id uuid null,
  created_at timestamptz not null default now(),
  check (amount > 0),
  check (status in ('Proposed', 'Approved', 'Rejected', 'Paid', 'Cancelled')),
  check (approved_by_user_id is null or approved_by_user_id <> proposed_by_user_id)
);

create table if not exists operations.budgets (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  budget_code text not null,
  category text not null,
  revision integer not null,
  amount numeric(19,4) not null,
  currency char(3) not null default 'BDT',
  status text not null,
  reason text null,
  created_by_user_id uuid not null,
  approved_by_user_id uuid null,
  created_at timestamptz not null default now(),
  approved_at timestamptz null,
  unique (organization_id, project_id, budget_code, revision),
  check (amount > 0),
  check (status in ('Draft', 'Approved', 'Superseded', 'Rejected')),
  check (approved_by_user_id is null or approved_by_user_id <> created_by_user_id)
);

create table if not exists operations.procurement_requests (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  budget_code text not null,
  vendor_name text not null,
  amount numeric(19,4) not null,
  currency char(3) not null default 'BDT',
  description text null,
  status text not null,
  requested_by_user_id uuid not null,
  approved_by_user_id uuid null,
  created_at timestamptz not null default now(),
  approved_at timestamptz null,
  check (amount > 0),
  check (status in ('Requested', 'Approved', 'Rejected', 'Cancelled', 'Closed')),
  check (approved_by_user_id is null or approved_by_user_id <> requested_by_user_id)
);

create table if not exists operations.expense_claims (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  procurement_id uuid null references operations.procurement_requests(id),
  budget_code text not null,
  amount numeric(19,4) not null,
  currency char(3) not null default 'BDT',
  invoice_ref text null,
  description text null,
  status text not null,
  submitted_by_user_id uuid not null,
  approved_by_user_id uuid null,
  created_at timestamptz not null default now(),
  approved_at timestamptz null,
  check (amount > 0),
  check (status in ('Submitted', 'Approved', 'Rejected', 'Paid', 'Capitalized')),
  check (approved_by_user_id is null or approved_by_user_id <> submitted_by_user_id)
);

create table if not exists operations.assets (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  expense_id uuid not null references operations.expense_claims(id),
  asset_tag text not null,
  asset_type text not null,
  acquisition_cost numeric(19,4) not null,
  currency char(3) not null default 'BDT',
  custody_user_id uuid null,
  status text not null,
  registered_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, asset_tag),
  check (acquisition_cost > 0),
  check (status in ('In Service', 'Under Maintenance', 'Retired', 'Disposed'))
);

create table if not exists operations.milestones (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  title text not null,
  due_date date not null,
  target_amount numeric(19,4) not null,
  currency char(3) not null default 'BDT',
  progress_percent integer not null default 0,
  status text not null,
  created_by_user_id uuid not null,
  verified_by_user_id uuid null,
  created_at timestamptz not null default now(),
  verified_at timestamptz null,
  check (target_amount > 0),
  check (progress_percent between 0 and 100),
  check (status in ('Planned', 'Evidence Submitted', 'Information Required', 'Verified', 'Rejected', 'Cancelled')),
  check (verified_by_user_id is null or verified_by_user_id <> created_by_user_id)
);

create table if not exists operations.milestone_deliverables (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  milestone_id uuid not null references operations.milestones(id),
  title text not null,
  evidence_required boolean not null default true
);

create table if not exists operations.milestone_evidence (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  milestone_id uuid not null references operations.milestones(id),
  evidence_ref text not null,
  submitted_by_user_id uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists operations.milestone_review_comments (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  milestone_id uuid not null references operations.milestones(id),
  comment text not null,
  recorded_by_user_id uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists operations.fund_releases (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  milestone_id uuid not null references operations.milestones(id),
  amount numeric(19,4) not null,
  currency char(3) not null default 'BDT',
  purpose text not null,
  status text not null,
  requested_by_user_id uuid not null,
  finance_approved_by_user_id uuid null,
  compliance_approved_by_user_id uuid null,
  released_by_user_id uuid null,
  posted_voucher_id uuid null,
  created_at timestamptz not null default now(),
  released_at timestamptz null,
  check (amount > 0),
  check (status in ('Requested', 'Finance Approved', 'Compliance Approved', 'Released', 'Rejected', 'Cancelled')),
  check (finance_approved_by_user_id is null or finance_approved_by_user_id <> requested_by_user_id),
  check (compliance_approved_by_user_id is null or compliance_approved_by_user_id <> requested_by_user_id)
);

create table if not exists operations.project_updates (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  title text not null,
  body text not null,
  visibility text not null,
  published_by_user_id uuid not null,
  published_at timestamptz not null default now(),
  check (visibility in ('Internal', 'Investors', 'Public'))
);

create table if not exists audit.audit_events (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid null,
  actor_user_id uuid not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  reason text null,
  correlation_id text not null,
  occurred_at timestamptz not null default now()
);

create table if not exists accounting.vouchers (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  voucher_no text not null,
  status text not null,
  created_by_user_id uuid not null,
  checked_by_user_id uuid null,
  authorized_by_user_id uuid null,
  posted_at timestamptz null,
  reversed_voucher_id uuid null references accounting.vouchers(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id, voucher_no),
  check (status in ('Draft', 'Submitted', 'Checked', 'Authorized', 'Posted', 'Returned', 'Rejected', 'Reversed')),
  check (authorized_by_user_id is null or authorized_by_user_id <> created_by_user_id)
);

create table if not exists accounting.chart_of_accounts (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  account_code text not null,
  name text not null,
  type text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, account_code),
  check (type in ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense'))
);

create table if not exists accounting.fiscal_periods (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  period_code text not null,
  status text not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz null,
  unique (organization_id, project_id, period_code),
  check (status in ('Open', 'Closed', 'Locked'))
);

create table if not exists accounting.voucher_lines (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  voucher_id uuid not null references accounting.vouchers(id),
  account_code text not null,
  debit numeric(19,4) not null default 0,
  credit numeric(19,4) not null default 0,
  currency char(3) not null default 'BDT',
  narration text null,
  check (debit >= 0 and credit >= 0),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create table if not exists accounting.journal_entries (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  voucher_id uuid not null references accounting.vouchers(id),
  voucher_no text not null,
  account_code text not null,
  debit numeric(19,4) not null default 0,
  credit numeric(19,4) not null default 0,
  currency char(3) not null default 'BDT',
  narration text null,
  posted_at timestamptz not null default now(),
  check (debit >= 0 and credit >= 0),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
