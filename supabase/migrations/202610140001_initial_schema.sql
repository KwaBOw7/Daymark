-- Daymark schema. Apply with: supabase db push (or paste into the SQL editor).
create extension if not exists pgcrypto;

create table if not exists public.schedule_events (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create table if not exists public.flexible_tasks (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create table if not exists public.schedule_preferences (
  id text not null default 'default' check (id = 'default'),
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create table if not exists public.session_logs (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  subscription jsonb not null check (jsonb_typeof(subscription) = 'object'),
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
create table if not exists public.reminder_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null,
  dedupe_key text not null,
  category text not null default 'other',
  title text not null,
  body text not null default 'Your scheduled time is coming up.',
  fire_at timestamptz not null,
  delivered_at timestamptz,
  attempts integer not null default 0,
  claimed_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
alter table public.reminder_queue add column if not exists claimed_until timestamptz;
create index if not exists reminder_queue_due_idx on public.reminder_queue(fire_at) where delivered_at is null;

-- Atomic reminder claims prevent overlapping Cron invocations from delivering the same row concurrently.
create or replace function public.claim_due_reminders(p_limit integer default 25)
returns setof public.reminder_queue language plpgsql security definer set search_path=public as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role_required'; end if;
  return query
  with due as (
    select q.id from public.reminder_queue q
    where q.delivered_at is null and q.attempts < 5 and q.fire_at <= now()
      and (q.claimed_until is null or q.claimed_until < now())
    order by q.fire_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,25),100))
  )
  update public.reminder_queue q set claimed_until=now()+interval '5 minutes'
  from due where q.id=due.id
  returning q.*;
end $$;
revoke all on function public.claim_due_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(integer) to service_role;
create index if not exists schedule_events_user_idx on public.schedule_events(user_id, updated_at desc);
create index if not exists flexible_tasks_user_idx on public.flexible_tasks(user_id, updated_at desc);

alter table public.schedule_events enable row level security;
alter table public.flexible_tasks enable row level security;
alter table public.schedule_preferences enable row level security;
alter table public.session_logs enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminder_queue enable row level security;

do $$ declare t text; begin
  foreach t in array array['schedule_events','flexible_tasks','schedule_preferences','session_logs','push_subscriptions','reminder_queue'] loop
    execute format('drop policy if exists "owner manages %s" on public.%I',t,t);
    execute format('create policy "owner manages %s" on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',t,t);
  end loop;
end $$;

-- Compare-and-swap RPCs: a stale client cannot overwrite another device's newer row silently.
create or replace function public.sync_schedule_event(p_id text,p_data jsonb,p_expected_updated_at timestamptz default null,p_delete boolean default false)
returns void language plpgsql security invoker set search_path=public as $$
declare current_time timestamptz; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication_required'; end if;
  select updated_at into current_time from public.schedule_events where id=p_id and user_id=uid for update;
  if p_delete then
    if current_time is not null and current_time is distinct from p_expected_updated_at then raise exception 'concurrent_edit'; end if;
    delete from public.schedule_events where id=p_id and user_id=uid; return;
  end if;
  if current_time is null then
    if p_expected_updated_at is not null then raise exception 'concurrent_edit'; end if;
    insert into public.schedule_events(id,user_id,data,updated_at) values(p_id,uid,p_data,coalesce((p_data->>'updatedAt')::timestamptz,now()));
  else
    if p_expected_updated_at is null or current_time is distinct from p_expected_updated_at then raise exception 'concurrent_edit'; end if;
    update public.schedule_events set data=p_data,updated_at=coalesce((p_data->>'updatedAt')::timestamptz,now()) where id=p_id and user_id=uid;
  end if;
end $$;
create or replace function public.sync_flexible_task(p_id text,p_data jsonb,p_expected_updated_at timestamptz default null,p_delete boolean default false)
returns void language plpgsql security invoker set search_path=public as $$
declare current_time timestamptz; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication_required'; end if;
  select updated_at into current_time from public.flexible_tasks where id=p_id and user_id=uid for update;
  if p_delete then
    if current_time is not null and current_time is distinct from p_expected_updated_at then raise exception 'concurrent_edit'; end if;
    delete from public.flexible_tasks where id=p_id and user_id=uid; return;
  end if;
  if current_time is null then
    if p_expected_updated_at is not null then raise exception 'concurrent_edit'; end if;
    insert into public.flexible_tasks(id,user_id,data,updated_at) values(p_id,uid,p_data,coalesce((p_data->>'updatedAt')::timestamptz,now()));
  else
    if p_expected_updated_at is null or current_time is distinct from p_expected_updated_at then raise exception 'concurrent_edit'; end if;
    update public.flexible_tasks set data=p_data,updated_at=coalesce((p_data->>'updatedAt')::timestamptz,now()) where id=p_id and user_id=uid;
  end if;
end $$;
create or replace function public.sync_session_log(p_id text,p_data jsonb,p_expected_updated_at timestamptz default null,p_delete boolean default false)
returns void language plpgsql security invoker set search_path=public as $$
declare current_time timestamptz; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication_required'; end if;
  select updated_at into current_time from public.session_logs where id=p_id and user_id=uid for update;
  if p_delete then
    if current_time is not null and current_time is distinct from p_expected_updated_at then raise exception 'concurrent_edit'; end if;
    delete from public.session_logs where id=p_id and user_id=uid; return;
  end if;
  if current_time is null then
    if p_expected_updated_at is not null then raise exception 'concurrent_edit'; end if;
    insert into public.session_logs(id,user_id,data,updated_at) values(p_id,uid,p_data,coalesce((p_data->>'loggedAt')::timestamptz,now()));
  else
    if p_expected_updated_at is null or current_time is distinct from p_expected_updated_at then raise exception 'concurrent_edit'; end if;
    update public.session_logs set data=p_data,updated_at=coalesce((p_data->>'loggedAt')::timestamptz,now()) where id=p_id and user_id=uid;
  end if;
end $$;
create or replace function public.sync_schedule_preferences(p_id text,p_data jsonb,p_expected_updated_at timestamptz default null,p_delete boolean default false)
returns void language plpgsql security invoker set search_path=public as $$
declare current_time timestamptz; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication_required'; end if;
  if p_id <> 'default' then raise exception 'invalid_preferences_id'; end if;
  select updated_at into current_time from public.schedule_preferences where id='default' and user_id=uid for update;
  if p_delete then delete from public.schedule_preferences where id='default' and user_id=uid; return; end if;
  if current_time is null then
    if p_expected_updated_at is not null then raise exception 'concurrent_edit'; end if;
    insert into public.schedule_preferences(id,user_id,data,updated_at) values('default',uid,p_data,coalesce((p_data->>'updatedAt')::timestamptz,now()));
  else
    if p_expected_updated_at is null or current_time is distinct from p_expected_updated_at then raise exception 'concurrent_edit'; end if;
    update public.schedule_preferences set data=p_data,updated_at=coalesce((p_data->>'updatedAt')::timestamptz,now()) where id='default' and user_id=uid;
  end if;
end $$;
-- RPCs are invoker-security and also rely on RLS, so there is no service-role key in the browser.
revoke all on function public.sync_schedule_event(text,jsonb,timestamptz,boolean) from public;
revoke all on function public.sync_flexible_task(text,jsonb,timestamptz,boolean) from public;
revoke all on function public.sync_session_log(text,jsonb,timestamptz,boolean) from public;
revoke all on function public.sync_schedule_preferences(text,jsonb,timestamptz,boolean) from public;
grant execute on function public.sync_schedule_event(text,jsonb,timestamptz,boolean) to authenticated;
grant execute on function public.sync_flexible_task(text,jsonb,timestamptz,boolean) to authenticated;
grant execute on function public.sync_session_log(text,jsonb,timestamptz,boolean) to authenticated;
grant execute on function public.sync_schedule_preferences(text,jsonb,timestamptz,boolean) to authenticated;

-- Generate 60 days of server-deliverable reminders on event writes. A unique dedupe key
-- protects against duplicate sync attempts, repeated cron runs and recurrence re-expansion.
create or replace function public.queue_event_reminders_for_event(p_event_id text,p_user_id uuid,p_event_data jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare
  tz text := coalesce((select data->>'timezone' from public.schedule_preferences where user_id=p_user_id and id='default'),'Africa/Accra');
  prefs jsonb := coalesce((select data from public.schedule_preferences where user_id=p_user_id and id='default'),'{}'::jsonb);
  occurrence date; last_date date; local_today date; rule jsonb := p_event_data->'recurrence'; daynum integer; start_at timestamptz; fire_time timestamptz; mins integer; instance_key text;
  cat text := coalesce(p_event_data->>'category','other');
begin
  local_today := (now() at time zone tz)::date;
  last_date := local_today + 60;
  delete from public.reminder_queue where user_id=p_user_id and event_id=p_event_id and delivered_at is null;
  if coalesce((prefs->>'remindersEnabled')::boolean,true)=false then return; end if;
  if coalesce((prefs->'categoryNotifications'->>cat)::boolean,true)=false then return; end if;
  if rule is null or rule='null'::jsonb then occurrence := (p_event_data->>'date')::date;
  else occurrence := greatest(coalesce((rule->>'startDate')::date,(p_event_data->>'date')::date),local_today); end if;
  while occurrence <= last_date and (rule is null or rule='null'::jsonb or not (rule ? 'endDate') or occurrence <= (rule->>'endDate')::date) loop
    daynum := extract(dow from occurrence);
    if occurrence >= (p_event_data->>'date')::date and (
      rule is null or rule='null'::jsonb or
      (rule->>'frequency'='daily') or
      (rule->>'frequency'='weekly' and (rule->'weekdays') @> to_jsonb(daynum))
    ) and not coalesce((rule->'exceptions') @> to_jsonb(occurrence::text),false) then
      start_at := ((occurrence + (p_event_data->>'start')::time) at time zone tz);
      for mins in select jsonb_array_elements_text(coalesce(p_event_data->'reminderMinutes','[10,0]'::jsonb))::integer loop
        if mins between 0 and 10080 then
          instance_key := p_event_id||':'||occurrence::text||':'||(p_event_data->>'start')||':'||mins::text;
          fire_time := start_at-make_interval(mins=>mins);
          if fire_time > now() then
            insert into public.reminder_queue(user_id,event_id,dedupe_key,category,title,body,fire_at)
            values(p_user_id,p_event_id,instance_key,cat,coalesce(p_event_data->>'title','Scheduled event'),case when mins=0 then 'It starts now.' else 'Starts in '||mins::text||' minute(s).' end,fire_time)
            on conflict(user_id,dedupe_key) do update set title=excluded.title,body=excluded.body,fire_at=excluded.fire_at,category=excluded.category;
          end if;
        end if;
      end loop;
    end if;
    occurrence := occurrence+1;
  end loop;
  return;
end $$;
revoke all on function public.queue_event_reminders_for_event(text,uuid,jsonb) from public, anon, authenticated;

create or replace function public.queue_event_reminders() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  perform public.queue_event_reminders_for_event(NEW.id,NEW.user_id,NEW.data);
  return NEW;
end $$;
drop trigger if exists schedule_event_reminders on public.schedule_events;
create trigger schedule_event_reminders after insert or update of data on public.schedule_events for each row execute function public.queue_event_reminders();
-- Users may manage their own subscription, but queue records are server-managed after insertion.
drop policy if exists "owner manages reminder_queue" on public.reminder_queue;
-- This migration is safe to re-run after a partial SQL Editor execution.
drop policy if exists "owner reads their reminder_queue" on public.reminder_queue;
create policy "owner reads their reminder_queue" on public.reminder_queue for select to authenticated using (auth.uid()=user_id);
drop policy if exists "owner manages push_subscriptions" on public.push_subscriptions;
create policy "owner manages push_subscriptions" on public.push_subscriptions for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
revoke insert, update, delete on public.reminder_queue from authenticated, anon;

create or replace function public.remove_queued_event_reminders() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  delete from public.reminder_queue where user_id=OLD.user_id and event_id=OLD.id and delivered_at is null;
  return OLD;
end $$;
drop trigger if exists delete_schedule_event_reminders on public.schedule_events;
create trigger delete_schedule_event_reminders after delete on public.schedule_events for each row execute function public.remove_queued_event_reminders();

-- Import is applied as one database transaction. Any stale version/error aborts the entire batch.
create or replace function public.sync_schedule_batch(p_ops jsonb) returns void
language plpgsql security invoker set search_path=public as $$
declare op jsonb; tab text; iid text; dat jsonb; expected timestamptz; deleting boolean;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if jsonb_typeof(p_ops)<>'array' then raise exception 'invalid_batch'; end if;
  for op in select value from jsonb_array_elements(p_ops) loop
    tab := op->>'table'; iid := op->>'id'; dat := coalesce(op->'data','{}'::jsonb);
    expected := nullif(op->>'expectedUpdatedAt','')::timestamptz; deleting := coalesce((op->>'deleted')::boolean,false);
    if tab='schedule_events' then perform public.sync_schedule_event(iid,dat,expected,deleting);
    elsif tab='flexible_tasks' then perform public.sync_flexible_task(iid,dat,expected,deleting);
    elsif tab='session_logs' then perform public.sync_session_log(iid,dat,expected,deleting);
    elsif tab='schedule_preferences' then perform public.sync_schedule_preferences(iid,dat,expected,deleting);
    else raise exception 'unsupported_batch_table'; end if;
  end loop;
end $$;
revoke all on function public.sync_schedule_batch(jsonb) from public;
grant execute on function public.sync_schedule_batch(jsonb) to authenticated;


-- Preference changes (timezone, category notifications and the master switch) refresh future
-- undelivered reminders for all of that user's event definitions.
create or replace function public.refresh_user_reminders_after_preferences() returns trigger
language plpgsql security definer set search_path=public as $$
declare item record;
begin
  for item in select id,user_id,data from public.schedule_events where user_id=NEW.user_id loop
    perform public.queue_event_reminders_for_event(item.id,item.user_id,item.data);
  end loop;
  return NEW;
end $$;
drop trigger if exists schedule_preferences_refresh_reminders on public.schedule_preferences;
create trigger schedule_preferences_refresh_reminders after insert or update of data on public.schedule_preferences for each row execute function public.refresh_user_reminders_after_preferences();


-- Opt the schedule tables into Supabase Realtime where the standard publication is present.
do $$ declare tab text; begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    foreach tab in array array['schedule_events','flexible_tasks','schedule_preferences','session_logs'] loop
      if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=tab) then
        execute format('alter publication supabase_realtime add table public.%I',tab);
      end if;
    end loop;
  end if;
end $$;


-- Apply the timestamp-type RPC fix on fresh installations too.
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
