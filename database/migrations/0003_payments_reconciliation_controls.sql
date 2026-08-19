-- CrowdFund360 Phase 6 completion: escrow accounts, payment states, provider callbacks,
-- reconciliation approval and lock, receipts, and daily cash control.
-- Synthetic foundation blueprint. No production data, PII, or credentials.

create table if not exists payments.project_accounts (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  account_code text not null,
  account_type text not null,
  bank_name text not null,
  account_fingerprint text not null,
  is_primary_collection boolean not null default false,
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  unique (organization_id, account_code),
  check (account_type in ('Escrow', 'Segregated Project', 'Operating')),
  check (status in ('Active', 'Closed')),
  check (is_primary_collection = false or account_type in ('Escrow', 'Segregated Project'))
);

-- Exactly one primary collection account per project prevents ambiguous investor settlement.
create unique index if not exists project_accounts_primary_collection_idx
  on payments.project_accounts (organization_id, project_id)
  where is_primary_collection and status = 'Active';

alter table payments.payment_instructions
  add column if not exists expected_amount numeric(19,4) null,
  add column if not exists settled_amount numeric(19,4) not null default 0,
  add column if not exists overpaid_amount numeric(19,4) not null default 0,
  add column if not exists settlement_kind text null,
  add column if not exists short_payment_reason text null,
  add column if not exists expires_at timestamptz null;

alter table payments.payment_instructions
  drop constraint if exists payment_instructions_status_check;

alter table payments.payment_instructions
  add constraint payment_instructions_status_check
  check (status in (
    'Issued', 'Unmatched', 'Partially Paid', 'Underpaid', 'Overpaid', 'Refund Pending',
    'Matched', 'Cleared', 'Returned', 'Reversed', 'Cancelled', 'Expired'
  ));

alter table payments.payment_instructions
  add constraint payment_instructions_settlement_check
  check (settled_amount >= 0 and overpaid_amount >= 0),
  add constraint payment_instructions_settlement_kind_check
  check (settlement_kind is null or settlement_kind in ('Full', 'Partial', 'Overpayment')),
  add constraint payment_instructions_overpaid_check
  check (expected_amount is null or overpaid_amount = greatest(settled_amount - expected_amount, 0));

alter table payments.bank_transactions
  add column if not exists project_account_id uuid null references payments.project_accounts(id),
  add column if not exists allocated_amount numeric(19,4) not null default 0,
  add column if not exists direction text not null default 'Credit',
  add column if not exists source text not null default 'Manual Import',
  add column if not exists provider_id text null,
  add column if not exists provider_event_id text null,
  add column if not exists settlement_ref text null,
  add column if not exists duplicate_of_bank_transaction_id uuid null references payments.bank_transactions(id),
  add column if not exists potential_duplicate_of_bank_transaction_id uuid null references payments.bank_transactions(id),
  add column if not exists unmatched_reason text null;

alter table payments.bank_transactions
  drop constraint if exists bank_transactions_status_check;

alter table payments.bank_transactions
  add constraint bank_transactions_status_check
  check (status in (
    'Imported', 'Unmatched', 'Matched', 'Split Matched', 'Aggregate Matched',
    'Duplicate', 'Returned', 'Failed', 'Reversed'
  ));

alter table payments.bank_transactions
  add constraint bank_transactions_allocation_check
  check (allocated_amount >= 0 and allocated_amount <= amount),
  add constraint bank_transactions_direction_check
  check (direction in ('Credit', 'Debit')),
  add constraint bank_transactions_source_check
  check (source in ('Manual Import', 'Provider Callback', 'Partner Settlement')),
  add constraint bank_transactions_duplicate_check
  check (status <> 'Duplicate' or duplicate_of_bank_transaction_id is not null);

-- A provider event may only ever produce one bank transaction.
create unique index if not exists bank_transactions_provider_event_idx
  on payments.bank_transactions (organization_id, provider_id, provider_event_id)
  where provider_event_id is not null;

create unique index if not exists bank_transactions_live_ref_idx
  on payments.bank_transactions (organization_id, transaction_ref)
  where status <> 'Duplicate';

alter table payments.reconciliations
  add column if not exists instruction_id uuid null references payments.payment_instructions(id),
  add column if not exists match_type text null,
  add column if not exists settlement_kind text null,
  add column if not exists applied_amount numeric(19,4) not null default 0,
  add column if not exists currency char(3) not null default 'BDT',
  add column if not exists matched_by_user_id uuid null,
  add column if not exists approved_by_user_id uuid null,
  add column if not exists locked_by_user_id uuid null,
  add column if not exists locked boolean not null default false;

alter table payments.reconciliations
  drop constraint if exists reconciliations_status_check;

alter table payments.reconciliations
  add constraint reconciliations_status_check
  check (status in ('Matched', 'Exception', 'Approved', 'Locked', 'Rejected', 'Reversed'));

alter table payments.reconciliations
  add constraint reconciliations_match_type_check
  check (match_type is null or match_type in ('Exact', 'Probable', 'Split', 'Aggregate', 'Manual')),
  add constraint reconciliations_applied_check
  check (applied_amount >= 0),
  add constraint reconciliations_exception_check
  check (status <> 'Exception' or applied_amount = 0),
  add constraint reconciliations_four_eyes
  check (approved_by_user_id is null or matched_by_user_id is null or approved_by_user_id <> matched_by_user_id),
  add constraint reconciliations_lock_check
  check (locked = false or status = 'Locked');

create table if not exists payments.reconciliation_transactions (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  reconciliation_id uuid not null references payments.reconciliations(id),
  bank_transaction_id uuid not null references payments.bank_transactions(id),
  unique (reconciliation_id, bank_transaction_id)
);

create table if not exists payments.provider_callback_events (
  id uuid primary key,
  provider_id text not null,
  provider_event_id text not null,
  nonce text not null,
  callback_timestamp bigint not null,
  outcome text not null,
  bank_transaction_id uuid null references payments.bank_transactions(id),
  received_at timestamptz not null default now(),
  unique (provider_id, provider_event_id),
  check (outcome in ('Settled', 'Failed', 'Returned'))
);

-- Nonce uniqueness is the replay control; it is enforced independently of event deduplication.
create unique index if not exists provider_callback_nonce_idx
  on payments.provider_callback_events (provider_id, nonce);

create table if not exists payments.settlement_batches (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  settlement_ref text not null,
  line_count integer not null default 0,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  gross_amount numeric(19,4) not null default 0,
  imported_by_user_id uuid not null,
  imported_at timestamptz not null default now(),
  unique (organization_id, settlement_ref),
  check (line_count = imported_count + duplicate_count),
  check (gross_amount >= 0)
);

create table if not exists payments.payment_receipts (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  investor_id uuid not null references investors.investors(id),
  commitment_id uuid not null references investments.commitments(id),
  instruction_id uuid not null references payments.payment_instructions(id),
  receipt_no text not null,
  payment_reference text not null,
  amount numeric(19,4) not null,
  currency char(3) not null default 'BDT',
  issued_by_user_id uuid not null,
  issued_at timestamptz not null default now(),
  unique (organization_id, receipt_no),
  unique (commitment_id),
  check (amount > 0)
);

alter table payments.refunds
  add column if not exists executed_by_user_id uuid null,
  add column if not exists executed_on date null,
  add column if not exists payment_reference text null;

alter table payments.refunds
  drop constraint if exists refunds_status_check;

alter table payments.refunds
  add constraint refunds_status_check
  check (status in ('Proposed', 'Approved', 'Executed', 'Failed', 'Returned', 'Rejected'));

alter table payments.refunds
  add constraint refunds_execution_check
  check (status <> 'Executed' or (executed_by_user_id is not null and executed_on is not null));

create table if not exists payments.daily_cash_controls (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid not null references projects.projects(id),
  control_date date not null,
  opening_balance numeric(19,4) not null,
  inflow_total numeric(19,4) not null default 0,
  outflow_total numeric(19,4) not null default 0,
  closing_balance numeric(19,4) not null,
  status text not null default 'Balanced',
  recorded_by_user_id uuid not null,
  recorded_at timestamptz not null default now(),
  unique (organization_id, project_id, control_date),
  check (inflow_total >= 0 and outflow_total >= 0),
  -- The daily cash identity is enforced by the database, not only by application code.
  check (closing_balance = opening_balance + inflow_total - outflow_total)
);
