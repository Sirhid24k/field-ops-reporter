-- Field Ops Reporter — migration 1: schema
-- Verbatim from docs/spec.md §7 (enums, 9 tables, indexes). Do not redesign here;
-- later changes go in new migrations.

create type user_role as enum ('admin','supervisor','field');
create type report_status as enum
  ('queued','transcribing','extracting','validating','needs_clarification','ready','reviewed','rejected','failed');
create type report_source as enum ('voice','text');
create type alert_severity as enum ('low','medium','high');
create type alert_status as enum ('open','acknowledged');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Africa/Lagos',
  report_cutoff_time time not null default '20:00',
  fuel_baseline_km_per_l numeric,            -- null until enough data
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  full_name text not null,
  phone text,
  role user_role not null default 'field',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  code text unique not null,
  role user_role not null default 'field',
  expires_at timestamptz not null,
  used_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  plate_number text not null,
  label text,
  vehicle_type text,
  default_driver_id uuid references profiles(id),
  current_odometer numeric,                  -- updated on report approval
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, plate_number)
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  client_uuid uuid not null,                 -- offline idempotency
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id),
  vehicle_id uuid not null references vehicles(id),
  report_date date not null,
  status report_status not null default 'queued',
  source report_source not null,
  audio_path text,                           -- storage: report-audio/{org}/{report}.webm
  audio_duration_s int,
  typed_note text,
  transcript text,
  transcript_language text,
  -- promoted fields for querying
  trip_status text,
  origin text,
  destination text,
  odometer_start numeric,
  odometer_end numeric,
  distance_km numeric generated always as (odometer_end - odometer_start) stored,
  fuel_liters numeric,
  fuel_cost_ngn numeric,
  load_type text,
  load_tonnage numeric,
  -- full model output + checks
  extracted jsonb,
  confidence jsonb,
  validation jsonb,                          -- [{rule, passed, message}]
  summary text,
  error text,
  submitted_at timestamptz not null default now(),
  processed_at timestamptz,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  unique (org_id, client_uuid)
);
create index on reports (org_id, report_date desc);
create index on reports (vehicle_id, report_date desc);
create index on reports (org_id, status);

create table clarifications (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  question text not null,
  answer_text text,
  answer_audio_path text,
  answered_at timestamptz,
  created_at timestamptz not null default now()
);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  report_id uuid references reports(id) on delete cascade,
  vehicle_id uuid references vehicles(id),
  type text not null,                        -- 'incident','odometer_jump','fuel_outlier','missing_report','duplicate'
  severity alert_severity not null,
  message text not null,
  status alert_status not null default 'open',
  acknowledged_by uuid references profiles(id),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);
create index on alerts (org_id, status, created_at desc);

create table daily_digests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  digest_date date not null,
  content_md text not null,
  stats jsonb not null,                      -- {reported, missing, alerts, total_km, total_fuel_l}
  generated_at timestamptz not null default now(),
  unique (org_id, digest_date)
);

create table report_edits (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  edited_by uuid not null references profiles(id),
  field text not null,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);
