-- Field Ops Reporter — migration 4: pipeline bookkeeping (session 3)
--
-- The processing state machine (lib/pipeline/process.ts) walks
-- queued → transcribing → extracting → validating → ready | needs_clarification | failed
-- with an atomic compare-and-set on `status` at every step. Two things the schema
-- did not have yet:
--
--   status_changed_at  when the status last changed; the sweep cron re-queues anything
--                      that has sat in a moving status for more than three minutes.
--   requeue_count      how many times the sweep has re-queued the report; after three
--                      it is marked failed instead (bounded retries).
--   answer_transcript  STT output for a voice answer to a clarification, kept next to
--                      the answer so a re-run does not transcribe it again.

alter table public.reports
  add column status_changed_at timestamptz not null default now(),
  add column requeue_count int not null default 0;

-- Every writer that changes `status` (pipeline, sweep, field actions, dashboard) gets
-- the timestamp for free. A write that keeps the same status leaves it alone; the sweep
-- sets it explicitly when it restarts a report that is already `queued`.
create or replace function public.touch_report_status_changed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at = now();
  end if;
  return new;
end
$$;

create trigger reports_status_changed_at
  before update of status on public.reports
  for each row
  execute function public.touch_report_status_changed_at();

-- The sweep's query: moving reports, oldest first.
create index reports_moving_status_idx
  on public.reports (status_changed_at)
  where status in ('queued', 'transcribing', 'extracting', 'validating');

alter table public.clarifications
  add column answer_transcript text;
