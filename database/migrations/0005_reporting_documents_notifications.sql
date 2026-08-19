-- CrowdFund360 Phase 11: dashboards, report exports, versioned documents, and notifications.
-- Synthetic foundation blueprint. No production data, PII, or credentials.

create schema if not exists documents;
create schema if not exists notifications;
create schema if not exists reporting;

create table if not exists documents.documents (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid null references projects.projects(id),
  document_type text not null,
  title text not null,
  classification text not null,
  investor_id uuid null references investors.investors(id),
  commitment_id uuid null references investments.commitments(id),
  milestone_id uuid null,
  retention_years integer not null default 7,
  status text not null default 'Draft',
  current_version integer not null default 0,
  withdrawn_reason text null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  check (document_type in ('Offer', 'Agreement', 'KYC', 'Approval', 'Receipt', 'Invoice', 'Evidence', 'Statement')),
  check (classification in ('Public', 'Internal', 'Confidential', 'Restricted Identity', 'Restricted Financial')),
  check (status in ('Draft', 'Active', 'Superseded', 'Withdrawn', 'Rejected')),
  check (status <> 'Withdrawn' or withdrawn_reason is not null),
  check (retention_years > 0)
);

create table if not exists documents.document_versions (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  document_id uuid not null references documents.documents(id),
  version integer not null,
  document_ref text not null,
  content_hash char(64) not null,
  reason text null,
  status text not null default 'Active',
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (document_id, version),
  check (status in ('Active', 'Superseded'))
);

-- Exactly one active version per document; superseded versions are retained, never overwritten.
create unique index if not exists document_versions_active_idx
  on documents.document_versions (document_id)
  where status = 'Active';

-- Document versions are append-only. A correction is a new version, never an edit.
create or replace function documents.reject_version_mutation() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Document versions are immutable. Add a new version instead.';
  end if;
  if new.document_ref is distinct from old.document_ref or new.content_hash is distinct from old.content_hash then
    raise exception 'Document version content is immutable. Add a new version instead.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists document_versions_immutable on documents.document_versions;
create trigger document_versions_immutable
  before update or delete on documents.document_versions
  for each row execute function documents.reject_version_mutation();

create table if not exists documents.extractions (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  document_id uuid not null references documents.documents(id),
  document_version_id uuid not null references documents.document_versions(id),
  engine text not null,
  confidence numeric(5,4) not null default 0,
  fields jsonb not null,
  status text not null default 'Extracted',
  authoritative boolean not null default false,
  correction_reason text null,
  extracted_by_user_id text not null,
  verified_by_user_id uuid null,
  verified_at timestamptz null,
  created_at timestamptz not null default now(),
  check (status in ('Extracted', 'Corrected', 'Verified', 'Rejected')),
  check (confidence >= 0 and confidence <= 1),
  -- Machine extraction is never authoritative until a human other than the extractor verifies it.
  check (authoritative = false or (status = 'Verified' and verified_by_user_id is not null)),
  check (verified_by_user_id is null or verified_by_user_id::text <> extracted_by_user_id)
);

create table if not exists documents.download_grants (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  document_id uuid not null references documents.documents(id),
  document_version_id uuid not null references documents.document_versions(id),
  token text not null unique,
  purpose text not null,
  watermark text not null,
  masked boolean not null default false,
  max_downloads integer not null default 1,
  download_count integer not null default 0,
  status text not null default 'Issued',
  issued_to_user_id uuid not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (status in ('Issued', 'Exhausted', 'Expired', 'Revoked')),
  check (max_downloads > 0),
  check (download_count >= 0 and download_count <= max_downloads),
  -- A grant is short-lived by construction; the application caps this at one hour.
  check (expires_at > issued_at)
);

create table if not exists documents.access_log (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  document_id uuid not null references documents.documents(id),
  document_version_id uuid not null references documents.document_versions(id),
  download_grant_id uuid not null references documents.download_grants(id),
  actor_user_id uuid not null,
  outcome text not null,
  masked boolean not null default false,
  purpose text not null,
  correlation_id text null,
  occurred_at timestamptz not null default now(),
  check (outcome in ('Downloaded', 'Exhausted', 'Expired', 'Denied'))
);

create index if not exists document_access_log_lookup_idx
  on documents.access_log (organization_id, document_id, occurred_at desc);

create table if not exists notifications.templates (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  template_key text not null,
  channel text not null,
  locale text not null,
  category text not null default 'operational',
  subject text null,
  body text not null,
  placeholders text[] not null default '{}',
  version integer not null,
  status text not null default 'Draft',
  synthetic_approval boolean not null default false,
  drafted_by_user_id text not null,
  approved_by_user_id text null,
  created_at timestamptz not null default now(),
  unique (organization_id, template_key, channel, locale, version),
  check (channel in ('Email', 'SMS', 'Push', 'In-App')),
  check (locale in ('en', 'bn')),
  check (status in ('Draft', 'Approved', 'Superseded', 'Withdrawn')),
  check (channel <> 'Email' or subject is not null),
  check (approved_by_user_id is null or approved_by_user_id <> drafted_by_user_id)
);

-- One approved template per key, channel, and locale.
create unique index if not exists notification_templates_approved_idx
  on notifications.templates (organization_id, template_key, channel, locale)
  where status = 'Approved';

create table if not exists notifications.preferences (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  user_id uuid not null references identity.users(id),
  locale text not null default 'en',
  channels jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  check (locale in ('en', 'bn'))
);

create table if not exists notifications.notifications (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid null references projects.projects(id),
  template_id uuid not null references notifications.templates(id),
  template_key text not null,
  channel text not null,
  locale text not null,
  locale_fallback_applied boolean not null default false,
  category text not null,
  recipient_user_id uuid not null references identity.users(id),
  -- Only a masked address is retained. Delivery addresses are personal data.
  recipient_address_masked text null,
  subject text null,
  body text not null,
  dedupe_key text null,
  status text not null default 'Queued',
  suppression_reason text null,
  attempts integer not null default 0,
  next_attempt_at timestamptz null,
  queued_by_user_id uuid not null,
  queued_at timestamptz not null default now(),
  delivered_at timestamptz null,
  failure_reason text null,
  check (channel in ('Email', 'SMS', 'Push', 'In-App')),
  check (locale in ('en', 'bn')),
  check (status in ('Queued', 'Sending', 'Retrying', 'Delivered', 'Failed', 'Suppressed', 'Cancelled')),
  check (attempts >= 0 and attempts <= 3),
  check (status <> 'Suppressed' or suppression_reason is not null),
  check (status <> 'Delivered' or delivered_at is not null),
  check (recipient_address_masked is null or recipient_address_masked not like '%@%.%@%')
);

create unique index if not exists notifications_dedupe_idx
  on notifications.notifications (organization_id, dedupe_key)
  where dedupe_key is not null;

create index if not exists notifications_due_idx
  on notifications.notifications (organization_id, status, next_attempt_at)
  where status in ('Queued', 'Retrying');

create table if not exists notifications.delivery_attempts (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  notification_id uuid not null references notifications.notifications(id),
  attempt integer not null,
  channel text not null,
  outcome text not null,
  failure_reason text null,
  next_attempt_at timestamptz null,
  correlation_id text null,
  occurred_at timestamptz not null default now(),
  unique (notification_id, attempt),
  check (attempt > 0),
  check (outcome in ('Delivered', 'Retrying', 'Failed'))
);

create table if not exists reporting.export_requests (
  id uuid primary key,
  organization_id uuid not null references identity.organizations(id),
  project_id uuid null references projects.projects(id),
  report_key text not null,
  period_id uuid null references accounting.fiscal_periods(id),
  format text not null,
  masking text not null,
  purpose text not null,
  sensitive boolean not null default false,
  requires_approval boolean not null default false,
  status text not null default 'Draft',
  requested_by_user_id uuid not null,
  approved_by_user_id uuid null,
  rejected_reason text null,
  generated_at timestamptz null,
  checksum char(64) null,
  source_checksum char(64) null,
  row_count integer null,
  document_id uuid null references documents.documents(id),
  download_grant_id uuid null references documents.download_grants(id),
  requested_at timestamptz not null default now(),
  check (format in ('csv', 'json')),
  check (masking in ('masked', 'unmasked')),
  check (status in ('Draft', 'Pending Approval', 'Approved', 'Generated', 'Downloaded', 'Expired', 'Rejected', 'Cancelled')),
  -- Unmasked sensitive data never leaves the platform without a second pair of eyes.
  check (requires_approval = (sensitive and masking = 'unmasked')),
  check (requires_approval = false or status not in ('Generated', 'Downloaded') or approved_by_user_id is not null),
  check (approved_by_user_id is null or approved_by_user_id <> requested_by_user_id),
  check (status <> 'Rejected' or rejected_reason is not null),
  check (status not in ('Generated', 'Downloaded') or (checksum is not null and row_count is not null))
);

create index if not exists export_requests_lookup_idx
  on reporting.export_requests (organization_id, project_id, status, requested_at desc);
