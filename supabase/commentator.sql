-- TT League Telegram commentator.
-- Run this entire file once in the TT League Supabase SQL Editor.
-- It keeps the league state and commentary event in the same transaction.

begin;

create table if not exists public.tt_commentary_events (
  id uuid primary key default gen_random_uuid(),
  tournament_id text not null,
  event_type text not null check (event_type in (
    'tournament_started', 'match_completed', 'match_voided', 'tournament_completed'
  )),
  dedupe_key text not null unique,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  telegram_message_id bigint,
  telegram_text text,
  error text,
  created_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz
);

alter table public.tt_commentary_events enable row level security;
revoke all on public.tt_commentary_events from public, anon, authenticated;
grant all on public.tt_commentary_events to service_role;
grant select on public.tt_league_state to service_role;

create index if not exists tt_commentary_events_status_created_idx
  on public.tt_commentary_events(status, created_at);
create index if not exists tt_commentary_events_tournament_idx
  on public.tt_commentary_events(tournament_id, created_at);

create or replace function public.tt_write(
  session_token text,
  expected_revision bigint,
  new_payload jsonb
)
returns bigint language plpgsql security definer set search_path=''
as $$
declare
  saved bigint;
  previous_payload jsonb;
  old_active jsonb;
  new_active jsonb;
  completed_tournament jsonb;
  changed_match jsonb;
begin
  if session_token is null or length(session_token)<>64 or not exists (
    select 1 from tt_private.sessions where
      token_hash=encode(extensions.digest(session_token,'sha256'),'hex')
      and expires_at>clock_timestamp()
  ) then raise exception 'Organizer session required' using errcode='42501'; end if;

  if expected_revision is null or expected_revision<0 or new_payload is null
    or jsonb_typeof(new_payload)<>'object'
    or not new_payload @> '{"version":1}'::jsonb
    or not new_payload ?& array['revision','players','tournaments'] then
    raise exception 'Invalid league' using errcode='22023';
  end if;
  if jsonb_typeof(new_payload->'players')<>'array'
    or jsonb_typeof(new_payload->'tournaments')<>'array'
    or jsonb_typeof(new_payload->'revision')<>'number' then
    raise exception 'Invalid league fields' using errcode='22023';
  end if;
  if (new_payload->>'revision')::numeric<>expected_revision+1
    or octet_length(new_payload::text)>20000000
    or jsonb_array_length(new_payload->'players')>1000
    or jsonb_array_length(new_payload->'tournaments')>5000 then
    raise exception 'Invalid league revision or size' using errcode='22023';
  end if;

  select payload into previous_payload
  from public.tt_league_state
  where id='main' and revision=expected_revision
  for update;
  if previous_payload is null then
    raise exception 'Concurrent change' using errcode='40001';
  end if;

  update public.tt_league_state set
    revision=expected_revision+1,
    payload=new_payload,
    updated_at=clock_timestamp()
  where id='main'
  returning revision into saved;

  select value into old_active
  from jsonb_array_elements(previous_payload->'tournaments') as item(value)
  where value->>'status'='active' limit 1;
  select value into new_active
  from jsonb_array_elements(new_payload->'tournaments') as item(value)
  where value->>'status'='active' limit 1;

  if old_active is null and new_active is not null then
    insert into public.tt_commentary_events(tournament_id,event_type,dedupe_key,payload)
    values(
      new_active->>'id', 'tournament_started', 'start:'||(new_active->>'id'),
      jsonb_build_object('tournament',new_active)
    ) on conflict(dedupe_key) do nothing;

  elsif old_active is not null and new_active is not null
    and old_active->>'id'=new_active->>'id' then
    if jsonb_array_length(new_active->'matches')=jsonb_array_length(old_active->'matches')+1 then
      changed_match=new_active->'matches'->(jsonb_array_length(new_active->'matches')-1);
      insert into public.tt_commentary_events(tournament_id,event_type,dedupe_key,payload)
      values(
        new_active->>'id', 'match_completed', 'match:'||(changed_match->>'id'),
        jsonb_build_object('tournament',new_active,'match',changed_match)
      ) on conflict(dedupe_key) do nothing;
    elsif jsonb_array_length(new_active->'voided')=jsonb_array_length(old_active->'voided')+1
      and jsonb_array_length(new_active->'matches')+1=jsonb_array_length(old_active->'matches') then
      changed_match=new_active->'voided'->(jsonb_array_length(new_active->'voided')-1);
      insert into public.tt_commentary_events(tournament_id,event_type,dedupe_key,payload)
      values(
        new_active->>'id', 'match_voided',
        'void:'||(changed_match->>'id')||':'||coalesce(changed_match->>'voidedAt','once'),
        jsonb_build_object('tournament',new_active,'match',changed_match)
      ) on conflict(dedupe_key) do nothing;
    end if;

  elsif old_active is not null and new_active is null then
    select value into completed_tournament
    from jsonb_array_elements(new_payload->'tournaments') as item(value)
    where value->>'id'=old_active->>'id' and value->>'status'='completed' limit 1;
    if completed_tournament is not null then
      insert into public.tt_commentary_events(tournament_id,event_type,dedupe_key,payload)
      values(
        completed_tournament->>'id', 'tournament_completed',
        'finish:'||(completed_tournament->>'id'),
        jsonb_build_object('tournament',completed_tournament)
      ) on conflict(dedupe_key) do nothing;
    end if;
  end if;

  -- Removing a tournament also removes its private commentary log. Existing
  -- Telegram messages remain in chat history.
  delete from public.tt_commentary_events e
  where not exists (
    select 1 from jsonb_array_elements(new_payload->'tournaments') as item(value)
    where value->>'id'=e.tournament_id
  );

  return saved;
end; $$;

revoke all on function public.tt_write(text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.tt_write(text,bigint,jsonb) to anon,authenticated;

-- An asynchronous pg_net trigger invokes the Edge Function after commit. The
-- function verifies the Supabase JWT and then checks that the event UUID still
-- belongs to a pending row before doing any work.
create extension if not exists pg_net;

create or replace function tt_private.notify_commentary_event()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  perform net.http_post(
    url := 'https://nnikaqkqwanhupljcigo.supabase.co/functions/v1/tt-commentator',
    body := jsonb_build_object(
      'type','INSERT',
      'table','tt_commentary_events',
      'schema','public',
      'record',to_jsonb(new),
      'old_record',null
    ),
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','REPLACE_WITH_SUPABASE_ANON_KEY',
      'Authorization','Bearer REPLACE_WITH_SUPABASE_ANON_KEY'
    ),
    timeout_milliseconds := 5000
  );
  return new;
end; $$;

revoke all on function tt_private.notify_commentary_event() from public,anon,authenticated;
drop trigger if exists tt_commentary_webhook on public.tt_commentary_events;
create trigger tt_commentary_webhook
after insert on public.tt_commentary_events
for each row execute function tt_private.notify_commentary_event();

notify pgrst,'reload schema';
commit;
