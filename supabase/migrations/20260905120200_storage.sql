-- Field Ops Reporter — migration 3: storage
--
-- Private bucket `report-audio`. Objects live under `{org_id}/...`
-- (e.g. `{org_id}/{report_id}.webm`). Org members can read their org's folder and
-- upload into it; the pipeline (service role) bypasses these policies.

insert into storage.buckets (id, name, public, file_size_limit)
values ('report-audio', 'report-audio', false, 26214400) -- 25 MB
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

create policy "org members read their org audio"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'report-audio'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );

create policy "org members upload audio into their org folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-audio'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );

-- lets a retried upload overwrite a partial object (upsert) without widening access
create policy "org members replace audio in their org folder"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'report-audio'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  )
  with check (
    bucket_id = 'report-audio'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );
