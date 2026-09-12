-- Field Ops Reporter — migration 8: atomic invite completion (session 6 review, FOR-01)
--
-- FOR-01. Completing an invite must be single-use even under concurrency. The application
-- cannot do it in two PostgREST calls: `invites.used_by` references `profiles(id)`, so the
-- invite can only be marked used AFTER the joining profile exists, which reopens the race
-- (two users each insert a profile, then each mark the invite used). This function does the
-- whole thing in one transaction:
--   1. lock the invite row FOR UPDATE while it is unclaimed — a second concurrent caller
--      blocks here and, once the first commits, sees used_by set and gets 'used';
--   2. insert the joining profile (used_by is still null, so no FK problem);
--   3. mark the invite used_by the new profile (which now exists, so the FK holds).
-- Idempotent for the same user (an existing profile short-circuits; a unique_violation from a
-- concurrent same-user completion returns 'member'). SECURITY DEFINER because it is called
-- with the service role from completeJoin (the joining user has no profile and no rights yet).

create or replace function public.complete_invite_join(
  p_invite_id uuid,
  p_user_id uuid,
  p_full_name text,
  p_org_id uuid,
  p_role public.user_role
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  -- already a member (the same user retrying): nothing to do
  if exists (select 1 from public.profiles where id = p_user_id) then
    return 'member';
  end if;

  -- claim the invite: lock it while unclaimed. A racer blocks until we commit, then the
  -- `used_by is null` predicate no longer holds for it and it gets 'used'.
  perform 1 from public.invites where id = p_invite_id and used_by is null for update;
  if not found then
    return 'used';
  end if;

  insert into public.profiles (id, org_id, full_name, role)
  values (p_user_id, p_org_id, p_full_name, p_role);

  update public.invites set used_by = p_user_id where id = p_invite_id;
  return 'ok';
exception
  when unique_violation then
    -- a concurrent completion for this same user won the profile insert
    return 'member';
end;
$$;

revoke execute on function public.complete_invite_join(uuid, uuid, text, uuid, public.user_role) from public, anon, authenticated;
grant execute on function public.complete_invite_join(uuid, uuid, text, uuid, public.user_role) to service_role;
