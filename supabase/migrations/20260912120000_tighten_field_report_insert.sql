-- Field Ops Reporter — migration 6: constrain the field report-insert policy (session 6 review)
--
-- FOR-02. The insert policy "users submit their own reports" only checked
--   user_id = auth.uid() AND org_id = current_org_id()
-- so a field user calling PostgREST directly (their own JWT, bypassing the createReport
-- server action) could insert a report with any column set: status = 'reviewed' with a
-- reviewed_by/reviewed_at of their choosing (a forged "Approved" report that shows on the
-- board, in the CSV and in the digest), a vehicle_id belonging to another organisation
-- (FOR-01/RLS-1: the service-role pipeline would then read that vehicle's odometer), or a
-- report_date far in the past or future (FOR-02/INT-1: corrupts boards and digests).
--
-- The pipeline overwrites extracted/validation/summary on any queued report, so the only way
-- to make fabricated fields stick is a non-queued status; and a driver never legitimately
-- creates a reviewed report or one for a foreign/really-old-or-future date. The createReport
-- action inserts exactly (client_uuid, org_id, user_id, vehicle_id, report_date, status
-- 'queued', source, typed_note, audio_duration_s) for an in-org vehicle dated today, so it
-- still passes. Staff writes go through the separate "staff manage org reports" policy and
-- the pipeline uses the service role, so neither is affected.

drop policy if exists "users submit their own reports" on public.reports;

create policy "users submit their own reports"
  on public.reports for insert to authenticated
  with check (
    user_id = auth.uid()
    and org_id = public.current_org_id()
    -- a driver may only create a fresh, unreviewed report; the pipeline promotes it from here
    and status = 'queued'
    and reviewed_by is null
    and reviewed_at is null
    -- the vehicle must belong to the driver's own organisation
    and exists (
      select 1 from public.vehicles v
      where v.id = reports.vehicle_id and v.org_id = public.current_org_id()
    )
    -- a sane report date: not absurdly old, not in the future beyond a timezone's lead
    -- (server is UTC, orgs may be ahead; the offline queue can hold a report a few days)
    and report_date > (current_date - interval '60 days')
    and report_date <= (current_date + interval '2 days')
  );
