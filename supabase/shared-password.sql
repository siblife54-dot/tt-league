-- TT LEAGUE ONLY. Do not run in Mindcore.
-- 1. Replace the password placeholder near the END of this file.
-- 2. Run the whole file in the TT League SQL Editor.
-- Existing league results are preserved. Re-running rotates the password and signs organizers out.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists tt_private;
revoke all on schema tt_private from public, anon, authenticated;

create table if not exists tt_private.password_config (
  id boolean primary key default true check(id),
  password_hash text not null,
  failures integer not null default 0,
  blocked_until timestamptz
);
create table if not exists tt_private.sessions (
  token_hash text primary key,
  expires_at timestamptz not null
);
alter table tt_private.password_config enable row level security;
alter table tt_private.sessions enable row level security;
revoke all on tt_private.password_config, tt_private.sessions from public, anon, authenticated;

create table if not exists public.tt_league_state (
  id text primary key check(id='main'),
  revision bigint not null default 0 check(revision>=0),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.tt_league_state enable row level security;
revoke all on public.tt_league_state from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.tt_league_state to anon, authenticated;
drop policy if exists tt_public_read on public.tt_league_state;
create policy tt_public_read on public.tt_league_state for select to anon, authenticated using(id='main');
insert into public.tt_league_state(id,revision,payload)
values ('main',0,'{"version":1,"revision":0,"players":[],"tournaments":[]}'::jsonb)
on conflict(id) do nothing;

-- Retire the earlier, uninstalled email/Auth proposal if it was ever applied.
drop function if exists public.tt_save_league(bigint,jsonb);

create or replace function public.tt_login(password text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare cfg tt_private.password_config%rowtype; raw_token text; expiry timestamptz;
begin
  select * into cfg from tt_private.password_config where id=true for update;
  if not found then return jsonb_build_object('error','not_configured'); end if;
  if cfg.blocked_until>clock_timestamp() then return jsonb_build_object('error','wait'); end if;
  if password is null or octet_length(password)>72 or
      extensions.crypt(password,cfg.password_hash) is distinct from cfg.password_hash then
    update tt_private.password_config set
      failures=case when cfg.blocked_until is not null then 1 else failures+1 end,
      blocked_until=case when cfg.blocked_until is null and failures+1>=10
        then clock_timestamp()+interval '1 minute' else null end
    where id=true;
    return jsonb_build_object('error','invalid_password');
  end if;
  update tt_private.password_config set failures=0,blocked_until=null where id=true;
  delete from tt_private.sessions where expires_at<=clock_timestamp();
  raw_token=encode(extensions.gen_random_bytes(32),'hex');
  expiry=clock_timestamp()+interval '12 hours';
  insert into tt_private.sessions(token_hash,expires_at)
    values(encode(extensions.digest(raw_token,'sha256'),'hex'),expiry);
  return jsonb_build_object('token',raw_token,'expires_at',expiry);
end; $$;

create or replace function public.tt_logout(session_token text)
returns void language sql security definer set search_path=''
as $$ delete from tt_private.sessions
where token_hash=encode(extensions.digest(session_token,'sha256'),'hex'); $$;

create or replace function public.tt_write(session_token text,expected_revision bigint,new_payload jsonb)
returns bigint language plpgsql security definer set search_path=''
as $$
declare saved bigint;
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
  update public.tt_league_state set revision=expected_revision+1,
    payload=new_payload,updated_at=clock_timestamp()
    where id='main' and revision=expected_revision returning revision into saved;
  if saved is null then
    raise exception 'Concurrent change' using errcode='40001';
  end if;
  return saved;
end; $$;

revoke all on function public.tt_login(text) from public,anon,authenticated;
revoke all on function public.tt_logout(text) from public,anon,authenticated;
revoke all on function public.tt_write(text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.tt_login(text),public.tt_logout(text),public.tt_write(text,bigint,jsonb) to anon,authenticated;

do $$
declare chosen_password text := 'REPLACE_WITH_YOUR_LEAGUE_PASSWORD';
begin
  if chosen_password='REPLACE_WITH_YOUR_LEAGUE_PASSWORD'
    or length(chosen_password)<8 or octet_length(chosen_password)>72 then
    raise exception 'Replace password placeholder: at least 8 characters, at most 72 UTF-8 bytes';
  end if;
  insert into tt_private.password_config(id,password_hash)
    values(true,extensions.crypt(chosen_password,extensions.gen_salt('bf',10)))
  on conflict(id) do update set password_hash=excluded.password_hash,failures=0,blocked_until=null;
  delete from tt_private.sessions;
end; $$;

notify pgrst,'reload schema';
commit;
