-- Daymark sync RPC repair
-- Fixes PostgreSQL's CURRENT_TIME keyword colliding with a PL/pgSQL variable
-- named current_time. Run this in Supabase SQL Editor; it is safe to rerun.
-- This updates the RPC bodies only and does not change data or disable RLS.

create or replace function public.sync_schedule_event(
  p_id text,
  p_data jsonb,
  p_expected_updated_at timestamptz default null,
  p_delete boolean default false
)
returns void
language plpgsql security invoker set search_path=public as $$
declare
  v_row_updated_at timestamptz;
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication_required'; end if;

  select updated_at into v_row_updated_at
  from public.schedule_events
  where id=p_id and user_id=uid
  for update;

  if p_delete then
    if v_row_updated_at is not null and v_row_updated_at is distinct from p_expected_updated_at then
      raise exception 'concurrent_edit';
    end if;
    delete from public.schedule_events where id=p_id and user_id=uid;
    return;
  end if;

  if v_row_updated_at is null then
    if p_expected_updated_at is not null then raise exception 'concurrent_edit'; end if;
    insert into public.schedule_events(id,user_id,data,updated_at)
    values(p_id,uid,p_data,coalesce((p_data->>'updatedAt')::timestamptz,now()));
  else
    if p_expected_updated_at is null or v_row_updated_at is distinct from p_expected_updated_at then
      raise exception 'concurrent_edit';
    end if;
    update public.schedule_events
    set data=p_data, updated_at=coalesce((p_data->>'updatedAt')::timestamptz,now())
    where id=p_id and user_id=uid;
  end if;
end $$;

create or replace function public.sync_flexible_task(
  p_id text,
  p_data jsonb,
  p_expected_updated_at timestamptz default null,
  p_delete boolean default false
)
returns void
language plpgsql security invoker set search_path=public as $$
declare
  v_row_updated_at timestamptz;
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication_required'; end if;

  select updated_at into v_row_updated_at
  from public.flexible_tasks
  where id=p_id and user_id=uid
  for update;

  if p_delete then
    if v_row_updated_at is not null and v_row_updated_at is distinct from p_expected_updated_at then
      raise exception 'concurrent_edit';
    end if;
    delete from public.flexible_tasks where id=p_id and user_id=uid;
    return;
  end if;

  if v_row_updated_at is null then
    if p_expected_updated_at is not null then raise exception 'concurrent_edit'; end if;
    insert into public.flexible_tasks(id,user_id,data,updated_at)
    values(p_id,uid,p_data,coalesce((p_data->>'updatedAt')::timestamptz,now()));
  else
    if p_expected_updated_at is null or v_row_updated_at is distinct from p_expected_updated_at then
      raise exception 'concurrent_edit';
    end if;
    update public.flexible_tasks
    set data=p_data, updated_at=coalesce((p_data->>'updatedAt')::timestamptz,now())
    where id=p_id and user_id=uid;
  end if;
end $$;

create or replace function public.sync_session_log(
  p_id text,
  p_data jsonb,
  p_expected_updated_at timestamptz default null,
  p_delete boolean default false
)
returns void
language plpgsql security invoker set search_path=public as $$
declare
  v_row_updated_at timestamptz;
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication_required'; end if;

  select updated_at into v_row_updated_at
  from public.session_logs
  where id=p_id and user_id=uid
  for update;

  if p_delete then
    if v_row_updated_at is not null and v_row_updated_at is distinct from p_expected_updated_at then
      raise exception 'concurrent_edit';
    end if;
    delete from public.session_logs where id=p_id and user_id=uid;
    return;
  end if;

  if v_row_updated_at is null then
    if p_expected_updated_at is not null then raise exception 'concurrent_edit'; end if;
    insert into public.session_logs(id,user_id,data,updated_at)
    values(p_id,uid,p_data,coalesce((p_data->>'loggedAt')::timestamptz,now()));
  else
    if p_expected_updated_at is null or v_row_updated_at is distinct from p_expected_updated_at then
      raise exception 'concurrent_edit';
    end if;
    update public.session_logs
    set data=p_data, updated_at=coalesce((p_data->>'loggedAt')::timestamptz,now())
    where id=p_id and user_id=uid;
  end if;
end $$;

create or replace function public.sync_schedule_preferences(
  p_id text,
  p_data jsonb,
  p_expected_updated_at timestamptz default null,
  p_delete boolean default false
)
returns void
language plpgsql security invoker set search_path=public as $$
declare
  v_row_updated_at timestamptz;
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication_required'; end if;
  if p_id <> 'default' then raise exception 'invalid_preferences_id'; end if;

  select updated_at into v_row_updated_at
  from public.schedule_preferences
  where id='default' and user_id=uid
  for update;

  if p_delete then
    delete from public.schedule_preferences where id='default' and user_id=uid;
    return;
  end if;

  if v_row_updated_at is null then
    if p_expected_updated_at is not null then raise exception 'concurrent_edit'; end if;
    insert into public.schedule_preferences(id,user_id,data,updated_at)
    values('default',uid,p_data,coalesce((p_data->>'updatedAt')::timestamptz,now()));
  else
    if p_expected_updated_at is null or v_row_updated_at is distinct from p_expected_updated_at then
      raise exception 'concurrent_edit';
    end if;
    update public.schedule_preferences
    set data=p_data, updated_at=coalesce((p_data->>'updatedAt')::timestamptz,now())
    where id='default' and user_id=uid;
  end if;
end $$;

-- Retain least-privilege RPC access. These are invoker-security functions and RLS remains enabled.
revoke all on function public.sync_schedule_event(text,jsonb,timestamptz,boolean) from public;
revoke all on function public.sync_flexible_task(text,jsonb,timestamptz,boolean) from public;
revoke all on function public.sync_session_log(text,jsonb,timestamptz,boolean) from public;
revoke all on function public.sync_schedule_preferences(text,jsonb,timestamptz,boolean) from public;
grant execute on function public.sync_schedule_event(text,jsonb,timestamptz,boolean) to authenticated;
grant execute on function public.sync_flexible_task(text,jsonb,timestamptz,boolean) to authenticated;
grant execute on function public.sync_session_log(text,jsonb,timestamptz,boolean) to authenticated;
grant execute on function public.sync_schedule_preferences(text,jsonb,timestamptz,boolean) to authenticated;

notify pgrst, 'reload schema';
