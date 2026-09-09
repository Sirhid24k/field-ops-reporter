-- Field Ops Reporter — migration 5: seed ownership tag (session 5)
--
-- `npm run seed` (scripts/seed.ts) fills the demo organisation with accounts, vehicles,
-- twelve days of history, today's board and past digests. Every row it creates carries
-- seed_tag = 'demo-v1' so a re-run can find and replace exactly its own rows and nothing
-- else: hand-made accounts, vehicles and the reports drivers actually sent are never
-- tagged and never touched. The column is nullable and unused by the application.

alter table public.profiles      add column seed_tag text;
alter table public.vehicles      add column seed_tag text;
alter table public.reports       add column seed_tag text;
alter table public.clarifications add column seed_tag text;
alter table public.alerts        add column seed_tag text;
alter table public.daily_digests add column seed_tag text;
alter table public.report_edits  add column seed_tag text;
alter table public.invites       add column seed_tag text;

comment on column public.reports.seed_tag is 'Set by scripts/seed.ts on rows it created; null for real data.';
