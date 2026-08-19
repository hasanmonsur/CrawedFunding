-- CrowdFund360 Phase 10: period close, profit and loss, loss treatment, and investor distribution.
-- Synthetic foundation blueprint. No production data, PII, or credentials.

create schema if not exists distributions;

-- Fiscal periods gain an explicit close workflow, bounded date range, and an immutable result snapshot.
alter table accounting.fiscal_periods
  add column if not exists sequence integer not null default 1,
  add column if not exists period_start timestamptz null,
  add column if not exists period_end timestamptz null,
  add column if not exists closed_by_user_id uuid null,
  add column if not exists locked_by_user_id uuid null,
  add column if not exists locked_at timestamptz null;

alter table accounting.fiscal_periods
  drop constraint if exists fiscal_periods_status_check;

alter table accounting.fiscal_periods
  add constraint fiscal_periods_status_check
  check (status in ('Open', 'Closing', 'Closed', 'Locked'));

alter table accounting.fiscal_periods
  add constraint fiscal_periods_lock_four_eyes
  check (locked_by_user_id is null or closed_by_user_id is null or locked_by_user_id <> closed_by_user_id);

create unique index if not exists fiscal_periods_project_sequence_idx
  on accounting.fiscal_periods (organization_id, project_id, sequence);

-- Journal entries and vouchers are stamped with the period they belong to so a locked period is reproducible.
alter table accounting.vouchers
  add column if not exists period_id uuid null references accounting.fiscal_periods(id);

alter table accounting.journal_entries
  add column if not exists period_id uuid null references accounting.fiscal_periods(id);

create index if not exists journal_entries_period_idx
  on accounting.journal_entries (organization_id, project_id, period_id);

create table if not exists accounting.period_close_checklist_items (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  period_id uuid not null references accounting.fiscal_periods(id),
  item_id text not null,
  label text not null,
  automated boolean not null default false,
  complete boolean not null default false,
  evidence_ref text null,
  completed_by_user_id uuid null,
  completed_at timestamptz null,
  unique (period_id, item_id),
  check (automated = false or evidence_ref is null),
  check (complete = false or automated = true or evidence_ref is not null)
);

create table if not exists accounting.period_results (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  period_id uuid not null references accounting.fiscal_periods(id),
  currency char(3) not null default 'BDT',
  revenue_total numeric(19,4) not null default 0,
  expense_total numeric(19,4) not null default 0,
  net_result numeric(19,4) not null,
  result_type text not null,
  loss_carry_forward_in numeric(19,4) not null default 0,
  loss_carry_forward_applied numeric(19,4) not null default 0,
  loss_carry_forward_out numeric(19,4) not null default 0,
  distributable_profit numeric(19,4) not null default 0,
  computed_at timestamptz not null default now(),
  unique (period_id),
  check (result_type in ('Profit', 'Loss')),
  check (revenue_total >= 0 and expense_total >= 0),
  check (loss_carry_forward_in >= 0 and loss_carry_forward_applied >= 0 and loss_carry_forward_out >= 0),
  check (distributable_profit >= 0),
  check (loss_carry_forward_applied <= loss_carry_forward_in),
  check (result_type = 'Loss' or distributable_profit = greatest(net_result - loss_carry_forward_applied, 0))
);

create table if not exists distributions.formula_versions (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  version integer not null,
  status text not null default 'Draft',
  basis text not null,
  minimum_holding_days integer not null default 0,
  loss_carry_forward_enabled boolean not null default true,
  rounding_mode text not null default 'floor-to-minor-unit',
  minor_unit_scale smallint not null default 2,
  residual_policy text not null,
  withholding_rate_percent numeric(9,4) not null default 0,
  reserve_rate_percent numeric(9,4) not null default 0,
  notes text null,
  created_by_user_id uuid not null,
  published_by_user_id uuid null,
  published_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (organization_id, project_id, version),
  check (status in ('Draft', 'Published', 'Retired')),
  check (basis in ('capital', 'capital-holding-period')),
  check (residual_policy in ('largest-remainder', 'retain-reserve')),
  check (minimum_holding_days >= 0),
  check (withholding_rate_percent >= 0 and withholding_rate_percent <= 100),
  check (reserve_rate_percent >= 0 and reserve_rate_percent <= 100),
  check (published_by_user_id is null or published_by_user_id <> created_by_user_id)
);

create unique index if not exists formula_versions_single_published_idx
  on distributions.formula_versions (organization_id, project_id)
  where status = 'Published';

create table if not exists distributions.distributions (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  period_id uuid not null references accounting.fiscal_periods(id),
  formula_version_id uuid not null references distributions.formula_versions(id),
  currency char(3) not null default 'BDT',
  status text not null default 'Draft',
  net_result numeric(19,4) not null,
  loss_carry_forward_applied numeric(19,4) not null default 0,
  distributable_amount numeric(19,4) not null,
  reserve_amount numeric(19,4) not null default 0,
  rounding_residual_amount numeric(19,4) not null default 0,
  residual_amount numeric(19,4) not null default 0,
  gross_total numeric(19,4) not null default 0,
  withholding_total numeric(19,4) not null default 0,
  net_total numeric(19,4) not null default 0,
  reconciled_net_total numeric(19,4) null,
  created_by_user_id uuid not null,
  reviewed_by_user_id uuid null,
  approved_by_user_id uuid null,
  payable_voucher_id uuid null references accounting.vouchers(id),
  batch_ref text null,
  batch_sequence integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in (
    'Draft', 'Calculated', 'Reviewed', 'Approved', 'Payable Posted', 'Payment Submitted',
    'Partially Paid', 'Reconciled', 'Held', 'Failed', 'Returned', 'Cancelled', 'Completed'
  )),
  check (distributable_amount >= 0 and gross_total >= 0 and residual_amount >= 0),
  check (gross_total = withholding_total + net_total),
  check (gross_total + residual_amount = distributable_amount),
  check (reviewed_by_user_id is null or reviewed_by_user_id <> created_by_user_id),
  check (approved_by_user_id is null or approved_by_user_id <> created_by_user_id),
  check (approved_by_user_id is null or reviewed_by_user_id is null or approved_by_user_id <> reviewed_by_user_id),
  check (status not in ('Payable Posted', 'Payment Submitted', 'Partially Paid', 'Reconciled', 'Completed')
    or payable_voucher_id is not null)
);

create unique index if not exists distributions_active_period_idx
  on distributions.distributions (organization_id, project_id, period_id)
  where status <> 'Cancelled';

create table if not exists distributions.entitlements (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  distribution_id uuid not null references distributions.distributions(id),
  investor_id uuid not null references investors.investors(id),
  commitment_id uuid not null references investments.commitments(id),
  basis text not null,
  capital_amount numeric(19,4) not null,
  eligible_days integer not null default 0,
  weight numeric(38,0) not null default 0,
  gross_amount numeric(19,4) not null default 0,
  withholding_amount numeric(19,4) not null default 0,
  net_amount numeric(19,4) not null default 0,
  currency char(3) not null default 'BDT',
  status text not null default 'Draft',
  hold_reason text null,
  exclusion_reason text null,
  payout_account_ref text null,
  payment_reference text null,
  failure_reason text null,
  batch_ref text null,
  reissue_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (distribution_id, commitment_id),
  check (status in (
    'Draft', 'Eligible', 'Payable', 'Payment Submitted', 'Paid', 'Failed', 'Returned',
    'Held', 'Reconciled', 'Excluded', 'Cancelled', 'Completed'
  )),
  check (gross_amount >= 0 and withholding_amount >= 0 and net_amount >= 0),
  check (gross_amount = withholding_amount + net_amount),
  check (status <> 'Excluded' or gross_amount = 0),
  check (status <> 'Held' or hold_reason is not null),
  check (status <> 'Excluded' or exclusion_reason is not null),
  check (reissue_count >= 0)
);

create index if not exists entitlements_investor_idx
  on distributions.entitlements (organization_id, investor_id);

create table if not exists distributions.payment_batches (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  distribution_id uuid not null references distributions.distributions(id),
  batch_ref text not null,
  currency char(3) not null default 'BDT',
  line_count integer not null default 0,
  net_total numeric(19,4) not null default 0,
  submitted_by_user_id uuid not null,
  submitted_at timestamptz not null default now(),
  unique (distribution_id, batch_ref),
  check (line_count >= 0 and net_total >= 0)
);

create table if not exists distributions.project_settlements (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  status text not null default 'Draft',
  distributions_completed integer not null default 0,
  settled_holdings integer not null default 0,
  lifetime_gross_distributed numeric(19,4) not null default 0,
  lifetime_withholding numeric(19,4) not null default 0,
  lifetime_net_distributed numeric(19,4) not null default 0,
  residual_loss_carry_forward numeric(19,4) not null default 0,
  settled_by_user_id uuid null,
  settled_at timestamptz null,
  archived_by_user_id uuid null,
  archived_at timestamptz null,
  unique (organization_id, project_id),
  check (status in ('Draft', 'Settled', 'Archived', 'Cancelled')),
  check (lifetime_gross_distributed = lifetime_withholding + lifetime_net_distributed),
  check (archived_by_user_id is null or settled_by_user_id is null or archived_by_user_id <> settled_by_user_id)
);
