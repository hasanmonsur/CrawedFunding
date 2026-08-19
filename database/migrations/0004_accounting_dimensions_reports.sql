-- CrowdFund360 Phase 7 completion: posting matrix versioning, accounting dimensions,
-- sub-ledgers, opening balances, controlled backdating, attachments, and report checksums.
-- Synthetic foundation blueprint. No production data, PII, or credentials.

alter table accounting.chart_of_accounts
  add column if not exists normal_balance text not null default 'Debit',
  add column if not exists book_type text null,
  add column if not exists sub_ledger text null,
  add column if not exists sub_ledger_dimension text null;

alter table accounting.chart_of_accounts
  add constraint chart_of_accounts_normal_balance_check
  check (normal_balance in ('Debit', 'Credit')),
  add constraint chart_of_accounts_book_type_check
  check (book_type is null or book_type in ('Cash', 'Bank')),
  add constraint chart_of_accounts_sub_ledger_check
  check (sub_ledger is null or sub_ledger in (
    'Investor', 'Vendor', 'Bank', 'Receivable', 'Payable',
    'Asset', 'Inventory', 'Reserve', 'Tax', 'Platform Fee'
  )),
  -- A dimension may only be declared on a control account.
  add constraint chart_of_accounts_dimension_requires_sub_ledger
  check (sub_ledger_dimension is null or sub_ledger is not null);

create table if not exists accounting.posting_matrix_versions (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  version integer not null,
  status text not null default 'Draft',
  notes text null,
  synthetic_approval boolean not null default false,
  rules jsonb not null,
  drafted_by_user_id text not null,
  approved_by_user_id text null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (organization_id, version),
  check (status in ('Draft', 'Approved', 'Superseded', 'Withdrawn')),
  -- The accountant who drafts a posting matrix cannot approve it.
  check (approved_by_user_id is null or approved_by_user_id <> drafted_by_user_id),
  check (status <> 'Approved' or approved_by_user_id is not null)
);

create unique index if not exists posting_matrix_single_approved_idx
  on accounting.posting_matrix_versions (organization_id)
  where status = 'Approved';

alter table accounting.vouchers
  add column if not exists posting_date timestamptz null,
  add column if not exists target_period_id uuid null references accounting.fiscal_periods(id),
  add column if not exists backdated boolean not null default false,
  add column if not exists backdate_reason text null,
  add column if not exists backdate_approved_by_user_id uuid null,
  add column if not exists posting_matrix_version integer null,
  add column if not exists origin text null;

alter table accounting.vouchers
  drop constraint if exists vouchers_voucher_type_check;

alter table accounting.vouchers
  add constraint vouchers_voucher_type_check
  check (voucher_type in (
    'Opening Balance', 'Journal', 'Receipt', 'Payment', 'Contra', 'Purchase', 'Sales',
    'Accrual', 'Adjustment', 'Depreciation', 'Distribution', 'Reversal'
  )),
  -- A backdated entry may only post once an independent approver has signed it off.
  add constraint vouchers_backdate_approval_check
  check (backdated = false or status <> 'Posted' or backdate_approved_by_user_id is not null),
  add constraint vouchers_backdate_four_eyes
  check (backdate_approved_by_user_id is null or backdate_approved_by_user_id <> created_by_user_id),
  add constraint vouchers_backdate_reason_check
  check (backdate_approved_by_user_id is null or backdate_reason is not null);

-- A project records at most one opening balance voucher.
create unique index if not exists vouchers_opening_balance_idx
  on accounting.vouchers (organization_id, project_id)
  where voucher_type = 'Opening Balance' and status <> 'Rejected';

create table if not exists accounting.voucher_attachments (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  voucher_id uuid not null references accounting.vouchers(id),
  document_ref text not null,
  description text null,
  created_at timestamptz not null default now(),
  unique (voucher_id, document_ref)
);

-- Accounting dimensions carried by both voucher lines and posted journal entries.
alter table accounting.voucher_lines
  add column if not exists account_type text null,
  add column if not exists sub_ledger text null,
  add column if not exists sub_ledger_key text null,
  add column if not exists cost_center text null,
  add column if not exists milestone_id uuid null,
  add column if not exists vendor_id uuid null,
  add column if not exists investor_id uuid null,
  add column if not exists commitment_id uuid null,
  add column if not exists counterparty_id text null,
  add column if not exists asset_id uuid null,
  add column if not exists inventory_item_id uuid null,
  add column if not exists reserve_code text null,
  add column if not exists tax_code text null,
  add column if not exists fee_code text null;

alter table accounting.journal_entries
  add column if not exists voucher_type text null,
  add column if not exists account_type text null,
  add column if not exists sub_ledger text null,
  add column if not exists sub_ledger_key text null,
  add column if not exists posting_date timestamptz null,
  add column if not exists cost_center text null,
  add column if not exists milestone_id uuid null,
  add column if not exists vendor_id uuid null,
  add column if not exists investor_id uuid null,
  add column if not exists commitment_id uuid null,
  add column if not exists counterparty_id text null,
  add column if not exists asset_id uuid null,
  add column if not exists inventory_item_id uuid null,
  add column if not exists reserve_code text null,
  add column if not exists tax_code text null,
  add column if not exists fee_code text null;

-- Every posting to a control account must carry its sub-ledger key.
alter table accounting.journal_entries
  add constraint journal_entries_sub_ledger_key_check
  check (sub_ledger is null or sub_ledger_key is not null);

alter table accounting.voucher_lines
  add constraint voucher_lines_sub_ledger_key_check
  check (sub_ledger is null or sub_ledger_key is not null);

create index if not exists journal_entries_sub_ledger_idx
  on accounting.journal_entries (organization_id, project_id, sub_ledger, sub_ledger_key);

create index if not exists journal_entries_investor_idx
  on accounting.journal_entries (organization_id, project_id, investor_id)
  where investor_id is not null;

-- Immutability of posted truth: journal entries may be inserted but never updated or deleted.
create or replace function accounting.reject_journal_mutation() returns trigger as $$
begin
  raise exception 'Posted journal entries are immutable. Correct them with a reversal voucher.';
end;
$$ language plpgsql;

drop trigger if exists journal_entries_immutable on accounting.journal_entries;
create trigger journal_entries_immutable
  before update or delete on accounting.journal_entries
  for each row execute function accounting.reject_journal_mutation();

create table if not exists accounting.report_snapshots (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  period_id uuid null references accounting.fiscal_periods(id),
  report text not null,
  as_of timestamptz not null,
  period_status text null,
  row_count integer not null default 0,
  checksum char(64) not null,
  payload jsonb not null,
  generated_by_user_id uuid not null,
  generated_at timestamptz not null default now(),
  check (report in (
    'sub-ledger', 'sub-ledger-reconciliation', 'cash-book', 'bank-book',
    'balance-sheet', 'cash-flow', 'fund-utilization', 'trial-balance',
    'general-ledger', 'profit-and-loss'
  )),
  check (row_count >= 0)
);

create index if not exists report_snapshots_lookup_idx
  on accounting.report_snapshots (organization_id, project_id, report, generated_at desc);
