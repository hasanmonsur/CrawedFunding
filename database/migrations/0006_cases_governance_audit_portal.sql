-- CrowdFund360 Phase 12: complaints, whistleblowing, compliance cases, governance holds,
-- the compliance rule engine, and the audit portal.
-- Synthetic foundation blueprint. No production data, PII, or credentials.

create schema if not exists cases;
create schema if not exists governance;

create table if not exists cases.complaints (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid null references projects.projects(id),
  category text not null,
  severity text not null,
  subject text not null,
  description text not null,
  investor_id uuid null references investors.investors(id),
  reported_by_user_id uuid null references identity.users(id),
  anonymous boolean not null default false,
  whistleblowing boolean not null default false,
  channel text not null default 'Portal',
  status text not null default 'Registered',
  assigned_to_user_id uuid null references identity.users(id),
  registered_at timestamptz not null default now(),
  acknowledge_due_at timestamptz not null,
  resolve_due_at timestamptz not null,
  acknowledged_at timestamptz null,
  resolved_at timestamptz null,
  resolved_by_user_id uuid null references identity.users(id),
  closed_at timestamptz null,
  resolution text null,
  rejection_reason text null,
  escalation_count integer not null default 0,
  appeal_count integer not null default 0,
  classification jsonb null,
  check (category in ('Service', 'Payment', 'Disclosure', 'Distribution', 'Data Privacy', 'Suspected Fraud', 'Misuse of Funds', 'Other')),
  check (severity in ('Low', 'Medium', 'High', 'Critical')),
  check (status in ('Registered', 'Triaged', 'Assigned', 'In Progress', 'Escalated', 'Resolved', 'Under Appeal', 'Closed', 'Rejected', 'Withdrawn')),
  check (resolve_due_at > acknowledge_due_at),
  check (status <> 'Resolved' or resolution is not null),
  -- A whistleblowing report must never carry the reporter's identity.
  check (whistleblowing = false or (reported_by_user_id is null and investor_id is null and anonymous)),
  -- The person who raised a complaint may not be the person who resolved it.
  check (resolved_by_user_id is null or reported_by_user_id is null or resolved_by_user_id <> reported_by_user_id),
  check (escalation_count >= 0 and appeal_count >= 0)
);

create index if not exists complaints_queue_idx
  on cases.complaints (organization_id, status, severity, resolve_due_at);

create table if not exists cases.complaint_events (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  complaint_id uuid not null references cases.complaints(id),
  action text not null,
  actor_user_id text not null,
  detail text null,
  occurred_at timestamptz not null default now()
);

-- The complaint history is append-only; it is the evidence of how a case was handled.
create or replace function cases.reject_complaint_event_mutation() returns trigger as $$
begin
  raise exception 'Complaint history is append-only.';
end;
$$ language plpgsql;

drop trigger if exists complaint_events_immutable on cases.complaint_events;
create trigger complaint_events_immutable
  before update or delete on cases.complaint_events
  for each row execute function cases.reject_complaint_event_mutation();

create table if not exists cases.complaint_evidence (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  complaint_id uuid not null references cases.complaints(id),
  document_id uuid not null references documents.documents(id),
  attached_at timestamptz not null default now(),
  unique (complaint_id, document_id)
);

create table if not exists cases.compliance_cases (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid null references projects.projects(id),
  source text not null,
  severity text not null,
  summary text not null,
  status text not null default 'Open',
  opened_by_user_id uuid not null references identity.users(id),
  opened_at timestamptz not null default now(),
  assigned_to_user_id uuid null references identity.users(id),
  resolution text null,
  resolved_by_user_id uuid null references identity.users(id),
  resolved_at timestamptz null,
  triggered_by_rule_id uuid null,
  check (source in ('KYC', 'Project', 'Payment', 'Fraud Signal', 'Duplicate Detection', 'Unusual Pattern', 'Complaint', 'Whistleblowing')),
  check (severity in ('Low', 'Medium', 'High', 'Critical')),
  check (status in ('Open', 'Under Investigation', 'Pending Information', 'Escalated', 'Resolved', 'Closed', 'Rejected')),
  check (status <> 'Resolved' or (resolution is not null and resolved_by_user_id is not null))
);

create table if not exists cases.case_links (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  case_id uuid not null references cases.compliance_cases(id),
  entity_type text not null,
  entity_id text not null,
  linked_by_user_id uuid not null references identity.users(id),
  linked_at timestamptz not null default now(),
  unique (case_id, entity_type, entity_id),
  check (entity_type in ('Investor', 'Project', 'Payment', 'Document', 'Voucher', 'Complaint', 'Compliance Case', 'Distribution'))
);

create index if not exists case_links_entity_idx
  on cases.case_links (organization_id, entity_type, entity_id);

create table if not exists governance.holds (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid null references projects.projects(id),
  subject_type text not null,
  subject_id text not null,
  reason text not null,
  case_id uuid null references cases.compliance_cases(id),
  status text not null default 'Active',
  placed_by_user_id uuid not null references identity.users(id),
  placed_at timestamptz not null default now(),
  expires_at timestamptz null,
  released_by_user_id uuid null references identity.users(id),
  released_at timestamptz null,
  release_reason text null,
  propagated boolean not null default false,
  check (subject_type in ('Investor', 'Payment', 'Project', 'Refund', 'Distribution')),
  check (status in ('Active', 'Released', 'Expired')),
  -- Whoever placed a hold cannot be the one who lifts it.
  check (released_by_user_id is null or released_by_user_id <> placed_by_user_id),
  check (status <> 'Released' or (released_by_user_id is not null and release_reason is not null))
);

-- At most one active hold per subject, so a release cannot leave a second hold silently in place.
create unique index if not exists governance_holds_active_subject_idx
  on governance.holds (organization_id, subject_type, subject_id)
  where status = 'Active';

create table if not exists governance.compliance_rules (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  name text not null,
  source text not null,
  severity text not null,
  match_mode text not null default 'all',
  conditions jsonb not null,
  action jsonb not null,
  version integer not null,
  status text not null default 'Draft',
  synthetic_approval boolean not null default false,
  suspension_reason text null,
  drafted_by_user_id text not null,
  approved_by_user_id text null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (organization_id, name, version),
  check (source in ('KYC', 'Project', 'Payment', 'Fraud Signal', 'Duplicate Detection', 'Unusual Pattern', 'Complaint', 'Whistleblowing')),
  check (severity in ('Low', 'Medium', 'High', 'Critical')),
  check (match_mode in ('all', 'any')),
  check (status in ('Draft', 'Approved', 'Suspended', 'Superseded', 'Withdrawn')),
  check (jsonb_array_length(conditions) > 0),
  -- The person who drafts a compliance rule cannot approve it.
  check (approved_by_user_id is null or approved_by_user_id <> drafted_by_user_id),
  check (status <> 'Approved' or approved_by_user_id is not null),
  check (status <> 'Suspended' or suspension_reason is not null)
);

create unique index if not exists compliance_rules_approved_idx
  on governance.compliance_rules (organization_id, name)
  where status = 'Approved';

create table if not exists governance.compliance_signals (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid null references projects.projects(id),
  signal_type text not null,
  payload jsonb not null,
  matched_rule_ids uuid[] not null default '{}',
  created_case_ids uuid[] not null default '{}',
  created_hold_ids uuid[] not null default '{}',
  flags jsonb not null default '[]',
  evaluated_by_user_id uuid not null references identity.users(id),
  evaluated_at timestamptz not null default now(),
  check (signal_type in ('KYC', 'Project', 'Payment', 'Fraud Signal', 'Duplicate Detection', 'Unusual Pattern', 'Complaint', 'Whistleblowing'))
);

create table if not exists governance.evidence_packages (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid null references projects.projects(id),
  title text not null,
  purpose text not null,
  case_id uuid null references cases.compliance_cases(id),
  status text not null default 'Draft',
  artefacts jsonb not null,
  built_by_user_id uuid not null references identity.users(id),
  built_at timestamptz not null default now(),
  sealed_by_user_id uuid null references identity.users(id),
  sealed_at timestamptz null,
  manifest_checksum char(64) null,
  check (status in ('Draft', 'Sealed', 'Cancelled')),
  check (jsonb_array_length(artefacts) > 0),
  check (status <> 'Sealed' or (manifest_checksum is not null and sealed_by_user_id is not null))
);

-- A sealed evidence package is immutable. That is what makes it evidence.
create or replace function governance.reject_sealed_package_mutation() returns trigger as $$
begin
  if old.status = 'Sealed' then
    raise exception 'A sealed evidence package cannot be modified.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists evidence_packages_sealed_immutable on governance.evidence_packages;
create trigger evidence_packages_sealed_immutable
  before update or delete on governance.evidence_packages
  for each row execute function governance.reject_sealed_package_mutation();
