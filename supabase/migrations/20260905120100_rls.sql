-- Field Ops Reporter — migration 2: row level security
--
-- Helpers are SECURITY DEFINER so policies on `profiles` can consult `profiles`
-- without recursing through RLS. They run as the migration owner (postgres),
-- which bypasses RLS on the tables it owns.
--
-- Access model (docs/spec.md §7):
--   admin / supervisor ("staff")  full read/write inside their org
--   field                         select/insert own reports + clarifications,
--                                 select vehicles in their org, select own profile,
--                                 select their org row (name shown on the field home);
--                                 nothing on alerts, daily_digests, report_edits, invites
--   anon                          nothing (invite validation runs server-side with the service role)
--   service_role                  bypasses RLS (server-only modules)

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

-- org of the signed-in user. Null when there is no profile yet (onboarding / invite
-- completion) or the profile has been deactivated, which makes every org-scoped
-- policy below fail closed for that user.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id
  from public.profiles
  where id = auth.uid()
    and active
$$;

-- role of the signed-in user, or null when there is no profile.
-- (named current_user_role because current_role is a reserved word)
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
$$;

-- true for an active admin or supervisor.
create or replace function public.is_org_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active
      and role in ('admin', 'supervisor')
  )
$$;

revoke execute on function public.current_org_id() from public, anon;
revoke execute on function public.current_user_role() from public, anon;
revoke execute on function public.is_org_staff() from public, anon;
grant execute on function public.current_org_id() to authenticated, service_role;
grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.is_org_staff() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- enable RLS everywhere; the anon role gets no table privileges at all
-- ---------------------------------------------------------------------------

alter table public.organizations  enable row level security;
alter table public.profiles       enable row level security;
alter table public.invites        enable row level security;
alter table public.vehicles       enable row level security;
alter table public.reports        enable row level security;
alter table public.clarifications enable row level security;
alter table public.alerts         enable row level security;
alter table public.daily_digests  enable row level security;
alter table public.report_edits   enable row level security;

revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

create policy "org members read their organization"
  on public.organizations for select to authenticated
  using (id = public.current_org_id());

create policy "staff update their organization"
  on public.organizations for update to authenticated
  using (id = public.current_org_id() and public.is_org_staff())
  with check (id = public.current_org_id() and public.is_org_staff());

-- no insert/delete policy: organizations are created during onboarding with the
-- service role (the signing-up admin has no profile, hence no org, at that point).

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create policy "users read their own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "staff manage org profiles"
  on public.profiles for all to authenticated
  using (org_id = public.current_org_id() and public.is_org_staff())
  with check (org_id = public.current_org_id() and public.is_org_staff());

-- ---------------------------------------------------------------------------
-- invites (staff only; the public /join page reads invites with the service role)
-- ---------------------------------------------------------------------------

create policy "staff manage org invites"
  on public.invites for all to authenticated
  using (org_id = public.current_org_id() and public.is_org_staff())
  with check (org_id = public.current_org_id() and public.is_org_staff());

-- ---------------------------------------------------------------------------
-- vehicles
-- ---------------------------------------------------------------------------

create policy "org members read org vehicles"
  on public.vehicles for select to authenticated
  using (org_id = public.current_org_id());

create policy "staff manage org vehicles"
  on public.vehicles for all to authenticated
  using (org_id = public.current_org_id() and public.is_org_staff())
  with check (org_id = public.current_org_id() and public.is_org_staff());

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------

create policy "users read their own reports"
  on public.reports for select to authenticated
  using (user_id = auth.uid());

create policy "users submit their own reports"
  on public.reports for insert to authenticated
  with check (user_id = auth.uid() and org_id = public.current_org_id());

create policy "staff manage org reports"
  on public.reports for all to authenticated
  using (org_id = public.current_org_id() and public.is_org_staff())
  with check (org_id = public.current_org_id() and public.is_org_staff());

-- ---------------------------------------------------------------------------
-- clarifications (ownership goes through the report)
-- ---------------------------------------------------------------------------

create policy "users read clarifications on their own reports"
  on public.clarifications for select to authenticated
  using (
    exists (
      select 1 from public.reports r
      where r.id = clarifications.report_id and r.user_id = auth.uid()
    )
  );

create policy "users add clarifications on their own reports"
  on public.clarifications for insert to authenticated
  with check (
    org_id = public.current_org_id()
    and exists (
      select 1 from public.reports r
      where r.id = clarifications.report_id and r.user_id = auth.uid()
    )
  );

create policy "staff manage org clarifications"
  on public.clarifications for all to authenticated
  using (org_id = public.current_org_id() and public.is_org_staff())
  with check (org_id = public.current_org_id() and public.is_org_staff());

-- ---------------------------------------------------------------------------
-- alerts, daily_digests, report_edits: staff only
-- ---------------------------------------------------------------------------

create policy "staff manage org alerts"
  on public.alerts for all to authenticated
  using (org_id = public.current_org_id() and public.is_org_staff())
  with check (org_id = public.current_org_id() and public.is_org_staff());

create policy "staff manage org digests"
  on public.daily_digests for all to authenticated
  using (org_id = public.current_org_id() and public.is_org_staff())
  with check (org_id = public.current_org_id() and public.is_org_staff());

-- report_edits has no org_id; scope through the report
create policy "staff manage org report edits"
  on public.report_edits for all to authenticated
  using (
    public.is_org_staff()
    and exists (
      select 1 from public.reports r
      where r.id = report_edits.report_id and r.org_id = public.current_org_id()
    )
  )
  with check (
    public.is_org_staff()
    and exists (
      select 1 from public.reports r
      where r.id = report_edits.report_id and r.org_id = public.current_org_id()
    )
  );
