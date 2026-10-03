-- FAST AMINOS WELLNESS · Progress Tracker database setup
-- Paste this whole file into Supabase: SQL Editor → New query → Run.
-- It is safe to run again; it updates what already exists.
--
-- Who can see what:
--   * Trainers (rows in public.trainers) see and edit every client.
--   * A client sees only their own record, check-ins and photos, matched by the
--     email the trainer entered for them.
--   * Only trainers can record Omron readings (gym-day calibration).
--   * Only trainers can write workout plans and check-in feedback; each client
--     can read their own.
--   * Plan templates are trainer-only; clients never see them.
--   * Workout logs: a client can log, read and delete their own; trainers see all.
--   * Apple Health daily totals: written by the client's iPhone app; the client
--     and trainers can read them.
--   * Paused clients (active = false) only see their own client record, so the
--     tracker can tell them coaching is paused. Everything else is hidden until
--     the trainer resumes them.
--   * Water: each client logs their own; trainers can read it.
--   * Any client can delete their own account and all their data (delete_my_account).
--   * Habits: clients check off their own and may edit only their own habit list.
--   * Messages: one thread per client between that client and the trainer.
--   * Signed-out visitors (anon) can't read or write anything.

create extension if not exists pgcrypto;

-- Helper functions live in a private schema that the Data API doesn't expose.
create schema if not exists private;

-- ---------- tables ----------
create table if not exists public.trainers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid unique references auth.users(id) on delete set null,
  email      text not null,
  name       text not null check (char_length(name) between 1 and 120),
  sex        text not null check (sex in ('male', 'female')),
  dob        date,
  height_in  numeric(4,1) not null check (height_in between 36 and 96),
  goal       text check (char_length(goal) <= 200),
  created_at timestamptz not null default now()
);
create unique index if not exists clients_email_key on public.clients (lower(email));

create table if not exists public.checkins (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  date        date not null default current_date,
  weight_lb   numeric(5,1) not null check (weight_lb between 50 and 700),
  waist_in    numeric(4,1) check (waist_in between 15 and 90),
  neck_in     numeric(4,1) check (neck_in between 8 and 30),
  hip_in      numeric(4,1) check (hip_in between 20 and 90),
  omron_bf    numeric(4,1) check (omron_bf between 3 and 70),
  photo_front text,
  photo_side  text,
  note        text check (char_length(note) <= 500),
  entered_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists checkins_client_date on public.checkins (client_id, date);
create index if not exists checkins_entered_by on public.checkins (entered_by);

-- Trainer feedback on a check-in (added October 2026).
alter table public.checkins add column if not exists coach_note text check (char_length(coach_note) <= 1000);
alter table public.checkins add column if not exists coach_note_at timestamptz;

-- How the client is feeling (added October 2026). 1–5 scales, optional.
alter table public.checkins add column if not exists energy smallint check (energy between 1 and 5);
alter table public.checkins add column if not exists hunger smallint check (hunger between 1 and 5);
alter table public.checkins add column if not exists sleep_q smallint check (sleep_q between 1 and 5);
alter table public.checkins add column if not exists sleep_hours numeric(3,1) check (sleep_hours between 0 and 16);
alter table public.checkins add column if not exists steps integer check (steps between 0 and 100000);
alter table public.checkins add column if not exists side_effects text[] check (cardinality(side_effects) <= 12);
alter table public.clients add column if not exists on_glp1 boolean not null default false;

-- Active / paused coaching (added October 2026). A paused client can still sign in
-- and see that they're paused, but can't open or add anything until the trainer
-- turns coaching back on. Their history is kept.
alter table public.clients add column if not exists active boolean not null default true;

-- Habits (added October 2026). clients.habits is the list the trainer assigned plus any
-- the client added: ["steps10k", "sleep7", {"id": "c-1", "label": "Read 10 pages"}].
-- Habits RENOVO can't measure are checked off by the client in habit_logs.
alter table public.clients add column if not exists habits jsonb check (habits is null or (jsonb_typeof(habits) = 'array' and pg_column_size(habits) < 8000));
create table if not exists public.habit_logs (
  client_id  uuid not null references public.clients(id) on delete cascade,
  date       date not null,
  habit_id   text not null check (char_length(habit_id) between 1 and 40),
  created_at timestamptz not null default now(),
  primary key (client_id, date, habit_id)
);

-- Messages between trainer and client (added October 2026). One thread per client.
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,
  sender     uuid default auth.uid() references auth.users(id) on delete set null,
  from_coach boolean not null default false,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
alter table public.messages add column if not exists pushed_at timestamptz;
create index if not exists messages_client_time on public.messages (client_id, created_at desc);
create index if not exists messages_sender on public.messages (sender);

-- Push notification tokens for the RENOVO app (added October 2026). One row per phone;
-- the notify-message Edge Function reads these with the service key to send message alerts.
create table if not exists public.device_tokens (
  token      text primary key check (char_length(token) between 32 and 200),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  env        text not null default 'production' check (env in ('production', 'sandbox')),
  updated_at timestamptz not null default now()
);
create index if not exists device_tokens_user on public.device_tokens (user_id);

-- Daily water (added October 2026). One row per client per day, in ounces.
-- water_goal_oz is set by the trainer; when empty the tracker uses half the
-- client's body weight in ounces.
alter table public.clients add column if not exists water_goal_oz smallint check (water_goal_oz between 16 and 256);
create table if not exists public.water_daily (
  client_id  uuid not null references public.clients(id) on delete cascade,
  date       date not null,
  oz         smallint not null default 0 check (oz between 0 and 640),
  updated_at timestamptz not null default now(),
  primary key (client_id, date)
);

-- One workout plan per client (added October 2026).
-- days is a list of {name, items: [{name, sets, reps, rest, note, ref}]}.
create table if not exists public.client_plans (
  client_id  uuid primary key references public.clients(id) on delete cascade,
  title      text check (char_length(title) <= 120),
  notes      text check (char_length(notes) <= 2000),
  days       jsonb not null default '[]'::jsonb check (jsonb_typeof(days) = 'array' and pg_column_size(days) < 200000),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists client_plans_updated_by on public.client_plans (updated_by);

-- Reusable plan templates for the trainer (added October 2026).
create table if not exists public.plan_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  title      text check (char_length(title) <= 120),
  notes      text check (char_length(notes) <= 2000),
  days       jsonb not null default '[]'::jsonb check (jsonb_typeof(days) = 'array' and pg_column_size(days) < 200000),
  updated_at timestamptz not null default now()
);
create unique index if not exists plan_templates_name_key on public.plan_templates (lower(name));

-- Logged workouts (added October 2026). entries is a list of
-- {name, ref, target, timed, done, sets: [{lb, reps}]}.
create table if not exists public.workout_logs (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,
  date       date not null default current_date,
  day_name   text check (char_length(day_name) <= 120),
  entries    jsonb not null default '[]'::jsonb check (jsonb_typeof(entries) = 'array' and pg_column_size(entries) < 100000),
  note       text check (char_length(note) <= 500),
  entered_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists workout_logs_client_date on public.workout_logs (client_id, date desc);
create index if not exists workout_logs_entered_by on public.workout_logs (entered_by);

-- Multi-week programs (added October 2026). A program is stored with the plan or
-- template: { name, weeks, daysPerWeek, start, phases: [...] }. Each logged workout
-- records which program run it belongs to, for progress and completion badges.
alter table public.client_plans   add column if not exists program jsonb check (program is null or (jsonb_typeof(program) = 'object' and pg_column_size(program) < 50000));
alter table public.plan_templates add column if not exists program jsonb check (program is null or (jsonb_typeof(program) = 'object' and pg_column_size(program) < 50000));
alter table public.workout_logs   add column if not exists program text check (char_length(program) <= 200);

-- One row per client per day, synced from Apple Health by the iPhone app (added October 2026).
create table if not exists public.health_daily (
  client_id    uuid not null references public.clients(id) on delete cascade,
  date         date not null,
  steps        integer check (steps between 0 and 200000),
  sleep_hours  numeric(4,2) check (sleep_hours between 0 and 24),
  weight_lb    numeric(5,1) check (weight_lb between 50 and 900),
  active_kcal  integer check (active_kcal between 0 and 20000),
  exercise_min integer check (exercise_min between 0 and 1440),
  resting_hr   integer check (resting_hr between 20 and 250),
  source       text check (char_length(source) <= 40),
  updated_at   timestamptz not null default now(),
  primary key (client_id, date)
);

-- Food logged in MyFitnessPal (or any app that shares nutrition to Apple Health),
-- one total per day, plus the client's daily targets set by the trainer (added October 2026).
alter table public.health_daily add column if not exists kcal_in   integer      check (kcal_in between 0 and 20000);
alter table public.health_daily add column if not exists protein_g numeric(6,1) check (protein_g between 0 and 2000);
alter table public.health_daily add column if not exists carbs_g   numeric(6,1) check (carbs_g between 0 and 3000);
alter table public.health_daily add column if not exists fat_g     numeric(6,1) check (fat_g between 0 and 1000);
-- Minutes in the client's Zone 2 heart rate range during watch workouts (added October 2026).
alter table public.health_daily add column if not exists zone2_min integer check (zone2_min between 0 and 1440);
-- Heart rate variability (SDNN, ms), daily average, for recovery scores (added October 2026).
alter table public.health_daily add column if not exists hrv_ms    integer      check (hrv_ms between 1 and 300);
alter table public.clients add column if not exists kcal_goal    smallint check (kcal_goal between 800 and 8000);
alter table public.clients add column if not exists protein_goal smallint check (protein_goal between 20 and 600);
alter table public.clients add column if not exists carbs_goal   smallint check (carbs_goal between 0 and 1000);
alter table public.clients add column if not exists fat_goal     smallint check (fat_goal between 10 and 400);


-- Older setups put helpers in public; remove them there.
drop function if exists public.is_trainer() cascade;
drop function if exists public.my_client_ids() cascade;
drop function if exists public.clients_link_email() cascade;
drop function if exists public.link_client_on_signup() cascade;
drop function if exists public.checkins_guard() cascade;

-- ---------- helpers (always about the signed-in user) ----------
create or replace function private.is_trainer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trainers where user_id = (select auth.uid()));
$$;

-- Only active clients count, so a paused client loses access to their check-ins,
-- plan, workouts, Health data and photos until coaching is turned back on.
create or replace function private.my_client_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.clients where user_id = (select auth.uid()) and active;
$$;

-- Every client record of the signed-in user, paused or not (used only for deleting their own photos).
create or replace function private.my_client_ids_any() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.clients where user_id = (select auth.uid());
$$;

-- When a client record is created (or its email changes), link it to an
-- existing login with that email.
create or replace function private.clients_link_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.email := lower(trim(new.email));
  if tg_op = 'UPDATE' and new.email is distinct from old.email then
    new.user_id := null;
  end if;
  if new.user_id is null then
    select u.id into new.user_id from auth.users u where lower(u.email) = new.email limit 1;
  end if;
  return new;
end $$;
drop trigger if exists clients_link_email on public.clients;
create trigger clients_link_email before insert or update of email on public.clients
  for each row execute function private.clients_link_email();

-- When someone signs in for the first time, link them to the client record
-- the trainer made for their email.
create or replace function private.link_client_on_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.clients set user_id = new.id
   where lower(email) = lower(new.email) and user_id is null;
  return new;
end $$;
drop trigger if exists link_client_on_signup on auth.users;
create trigger link_client_on_signup after insert on auth.users
  for each row execute function private.link_client_on_signup();

-- Clients can't set Omron readings or change who entered a check-in.
create or replace function private.checkins_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.entered_by := (select auth.uid());
    new.created_at := now();
    if not private.is_trainer() then
      new.omron_bf := null; new.coach_note := null; new.coach_note_at := null;
    elsif new.coach_note is not null then
      new.coach_note_at := now();
    end if;
  else
    new.entered_by := old.entered_by;
    new.client_id  := old.client_id;
    new.created_at := old.created_at;
    if not private.is_trainer() then
      new.omron_bf := old.omron_bf; new.coach_note := old.coach_note; new.coach_note_at := old.coach_note_at;
    elsif new.coach_note is distinct from old.coach_note then
      new.coach_note_at := case when new.coach_note is null then null else now() end;
    else
      new.coach_note_at := old.coach_note_at;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists checkins_guard on public.checkins;
create trigger checkins_guard before insert or update on public.checkins
  for each row execute function private.checkins_guard();

-- Plans always record who saved them and when.
create or replace function private.client_plans_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.client_id := old.client_id; end if;
  return new;
end $$;
drop trigger if exists client_plans_stamp on public.client_plans;
create trigger client_plans_stamp before insert or update on public.client_plans
  for each row execute function private.client_plans_stamp();

create or replace function private.plan_templates_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists plan_templates_stamp on public.plan_templates;
create trigger plan_templates_stamp before insert or update on public.plan_templates
  for each row execute function private.plan_templates_stamp();

-- Workout logs always record who logged them; the client can't be changed later.
create or replace function private.workout_logs_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.entered_by := (select auth.uid());
    new.created_at := now();
  else
    new.entered_by := old.entered_by;
    new.client_id  := old.client_id;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists workout_logs_guard on public.workout_logs;
create trigger workout_logs_guard before insert or update on public.workout_logs
  for each row execute function private.workout_logs_guard();

create or replace function private.health_daily_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.client_id := old.client_id; new.date := old.date; end if;
  return new;
end $$;
drop trigger if exists health_daily_stamp on public.health_daily;
create trigger health_daily_stamp before insert or update on public.health_daily
  for each row execute function private.health_daily_stamp();

create or replace function private.water_daily_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.client_id := old.client_id; new.date := old.date; end if;
  return new;
end $$;
drop trigger if exists water_daily_stamp on public.water_daily;
create trigger water_daily_stamp before insert or update on public.water_daily
  for each row execute function private.water_daily_stamp();

-- Clients may change only their own habit list; everything else on their record stays the trainer's.
create or replace function private.clients_client_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare h jsonb := new.habits;
begin
  if not private.is_trainer() then
    new := old;
    new.habits := h;
  end if;
  return new;
end $$;
drop trigger if exists clients_client_guard on public.clients;
create trigger clients_client_guard before update on public.clients
  for each row execute function private.clients_client_guard();

-- Messages: sender and side are always set by the database; after sending, only read_at
-- can change, and only by the person the message was sent to.
create or replace function private.messages_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.sender := (select auth.uid());
    new.from_coach := private.is_trainer();
    new.created_at := now();
    new.read_at := null;
    new.pushed_at := null;
  else
    if old.sender = (select auth.uid()) then raise exception 'You can''t edit a sent message'; end if;
    new.id := old.id; new.client_id := old.client_id; new.sender := old.sender;
    new.from_coach := old.from_coach; new.body := old.body; new.created_at := old.created_at;
    -- Only the push sender (server side, no signed-in user) marks a message as pushed.
    if (select auth.uid()) is not null then new.pushed_at := old.pushed_at; end if;
  end if;
  return new;
end $$;
drop trigger if exists messages_guard on public.messages;
create trigger messages_guard before insert or update on public.messages
  for each row execute function private.messages_guard();

-- Push notifications: each new message asks the notify-message Edge Function to buzz the
-- other person's phone. The function looks the message up itself and sends each one once,
-- so it needs no key. If the call fails, the message still sends.
create or replace function private.messages_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://zfkhkdkibuwpigpvsmkd.supabase.co/functions/v1/notify-message',
    body := jsonb_build_object('message_id', new.id),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
exception when others then
  return new;
end $$;
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
    drop trigger if exists messages_push on public.messages;
    create trigger messages_push after insert on public.messages
      for each row execute function private.messages_push();
  end if;
end $$;

-- Only signed-in users may run the two lookup helpers (policies need them).
-- Nobody calls the trigger functions directly.
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_trainer() to authenticated;
grant execute on function private.my_client_ids() to authenticated;
grant execute on function private.my_client_ids_any() to authenticated;

-- ---------- Data API access ----------
-- New Supabase projects don't expose new tables automatically, so grant
-- signed-in users access explicitly. Row level security below decides which rows.
revoke all on public.trainers, public.clients, public.checkins, public.client_plans, public.plan_templates, public.workout_logs, public.health_daily, public.water_daily, public.habit_logs, public.messages, public.device_tokens from anon;
grant select on public.trainers to authenticated;
grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.checkins to authenticated;
grant select, insert, update, delete on public.client_plans to authenticated;
grant select, insert, update, delete on public.plan_templates to authenticated;
grant select, insert, update, delete on public.workout_logs to authenticated;
grant select, insert, update, delete on public.health_daily to authenticated;
grant select, insert, update, delete on public.water_daily to authenticated;
grant select, insert, update, delete on public.habit_logs to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, update, delete on public.device_tokens to authenticated;

-- ---------- row level security ----------
alter table public.trainers enable row level security;
alter table public.clients  enable row level security;
alter table public.checkins enable row level security;
alter table public.client_plans enable row level security;
alter table public.plan_templates enable row level security;
alter table public.workout_logs enable row level security;
alter table public.health_daily enable row level security;
alter table public.water_daily enable row level security;
alter table public.habit_logs enable row level security;
alter table public.messages enable row level security;
alter table public.device_tokens enable row level security;

drop policy if exists "trainers read self" on public.trainers;
create policy "trainers read self" on public.trainers
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "clients read" on public.clients;
create policy "clients read" on public.clients
  for select to authenticated
  using ((select private.is_trainer()) or user_id = (select auth.uid()));

drop policy if exists "clients trainer insert" on public.clients;
create policy "clients trainer insert" on public.clients
  for insert to authenticated with check ((select private.is_trainer()));

drop policy if exists "clients trainer update" on public.clients;
create policy "clients trainer update" on public.clients
  for update to authenticated
  using ((select private.is_trainer())) with check ((select private.is_trainer()));

drop policy if exists "clients trainer delete" on public.clients;
create policy "clients trainer delete" on public.clients
  for delete to authenticated using ((select private.is_trainer()));

drop policy if exists "checkins read" on public.checkins;
create policy "checkins read" on public.checkins
  for select to authenticated
  using ((select private.is_trainer()) or client_id in (select private.my_client_ids()));

drop policy if exists "checkins insert" on public.checkins;
create policy "checkins insert" on public.checkins
  for insert to authenticated
  with check ((select private.is_trainer()) or client_id in (select private.my_client_ids()));

drop policy if exists "checkins update" on public.checkins;
create policy "checkins update" on public.checkins
  for update to authenticated
  using ((select private.is_trainer()) or (entered_by = (select auth.uid()) and client_id in (select private.my_client_ids())))
  with check ((select private.is_trainer()) or (entered_by = (select auth.uid()) and client_id in (select private.my_client_ids())));

drop policy if exists "checkins delete" on public.checkins;
create policy "checkins delete" on public.checkins
  for delete to authenticated
  using ((select private.is_trainer()) or (entered_by = (select auth.uid()) and client_id in (select private.my_client_ids())));

drop policy if exists "plans read" on public.client_plans;
create policy "plans read" on public.client_plans
  for select to authenticated
  using ((select private.is_trainer()) or client_id in (select private.my_client_ids()));

drop policy if exists "plans trainer insert" on public.client_plans;
create policy "plans trainer insert" on public.client_plans
  for insert to authenticated with check ((select private.is_trainer()));

drop policy if exists "plans trainer update" on public.client_plans;
create policy "plans trainer update" on public.client_plans
  for update to authenticated
  using ((select private.is_trainer())) with check ((select private.is_trainer()));

drop policy if exists "plans trainer delete" on public.client_plans;
create policy "plans trainer delete" on public.client_plans
  for delete to authenticated using ((select private.is_trainer()));

drop policy if exists "workouts read" on public.workout_logs;
create policy "workouts read" on public.workout_logs
  for select to authenticated
  using ((select private.is_trainer()) or client_id in (select private.my_client_ids()));

drop policy if exists "workouts insert" on public.workout_logs;
create policy "workouts insert" on public.workout_logs
  for insert to authenticated
  with check ((select private.is_trainer()) or client_id in (select private.my_client_ids()));

drop policy if exists "workouts update" on public.workout_logs;
create policy "workouts update" on public.workout_logs
  for update to authenticated
  using ((select private.is_trainer()) or client_id in (select private.my_client_ids()))
  with check ((select private.is_trainer()) or client_id in (select private.my_client_ids()));

drop policy if exists "workouts delete" on public.workout_logs;
create policy "workouts delete" on public.workout_logs
  for delete to authenticated
  using ((select private.is_trainer()) or client_id in (select private.my_client_ids()));

drop policy if exists "health read" on public.health_daily;
create policy "health read" on public.health_daily
  for select to authenticated
  using ((select private.is_trainer()) or client_id in (select private.my_client_ids()));

drop policy if exists "health write own" on public.health_daily;
create policy "health write own" on public.health_daily
  for insert to authenticated
  with check (client_id in (select private.my_client_ids()));

drop policy if exists "health update own" on public.health_daily;
create policy "health update own" on public.health_daily
  for update to authenticated
  using (client_id in (select private.my_client_ids()))
  with check (client_id in (select private.my_client_ids()));

drop policy if exists "health delete" on public.health_daily;
create policy "health delete" on public.health_daily
  for delete to authenticated
  using ((select private.is_trainer()) or client_id in (select private.my_client_ids()));

drop policy if exists "water read" on public.water_daily;
create policy "water read" on public.water_daily
  for select to authenticated
  using ((select private.is_trainer()) or client_id in (select private.my_client_ids()));

drop policy if exists "water write own" on public.water_daily;
create policy "water write own" on public.water_daily
  for insert to authenticated
  with check (client_id in (select private.my_client_ids()));

drop policy if exists "water update own" on public.water_daily;
create policy "water update own" on public.water_daily
  for update to authenticated
  using (client_id in (select private.my_client_ids()))
  with check (client_id in (select private.my_client_ids()));

drop policy if exists "water delete" on public.water_daily;
create policy "water delete" on public.water_daily
  for delete to authenticated
  using ((select private.is_trainer()) or client_id in (select private.my_client_ids()));

drop policy if exists "clients update own habits" on public.clients;
create policy "clients update own habits" on public.clients
  for update to authenticated
  using (id in (select private.my_client_ids())) with check (id in (select private.my_client_ids()));

drop policy if exists "habits read" on public.habit_logs;
create policy "habits read" on public.habit_logs
  for select to authenticated
  using ((select private.is_trainer()) or client_id in (select private.my_client_ids()));
drop policy if exists "habits write own" on public.habit_logs;
create policy "habits write own" on public.habit_logs
  for insert to authenticated with check (client_id in (select private.my_client_ids()));
drop policy if exists "habits delete own" on public.habit_logs;
create policy "habits delete own" on public.habit_logs
  for delete to authenticated using (client_id in (select private.my_client_ids()));

drop policy if exists "messages read" on public.messages;
create policy "messages read" on public.messages
  for select to authenticated
  using ((select private.is_trainer()) or client_id in (select private.my_client_ids()));
drop policy if exists "messages send" on public.messages;
create policy "messages send" on public.messages
  for insert to authenticated
  with check ((select private.is_trainer()) or client_id in (select private.my_client_ids()));
drop policy if exists "messages mark read" on public.messages;
create policy "messages mark read" on public.messages
  for update to authenticated
  using ((select private.is_trainer()) or client_id in (select private.my_client_ids()))
  with check ((select private.is_trainer()) or client_id in (select private.my_client_ids()));

-- A phone's token belongs to whoever signed in on it last.
drop policy if exists "tokens own" on public.device_tokens;
create policy "tokens own" on public.device_tokens
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create or replace function private.device_tokens_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.user_id := (select auth.uid());
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists device_tokens_stamp on public.device_tokens;
create trigger device_tokens_stamp before insert or update on public.device_tokens
  for each row execute function private.device_tokens_stamp();
-- When someone else signs in on a phone, the token moves to them.
create or replace function public.claim_device_token(p_token text, p_env text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Not signed in'; end if;
  insert into public.device_tokens (token, user_id, env, updated_at)
  values (p_token, (select auth.uid()), case when p_env = 'sandbox' then 'sandbox' else 'production' end, now())
  on conflict (token) do update set user_id = excluded.user_id, env = excluded.env, updated_at = now();
end $$;
revoke all on function public.claim_device_token(text, text) from public, anon;
grant execute on function public.claim_device_token(text, text) to authenticated;

drop policy if exists "templates trainer only" on public.plan_templates;
create policy "templates trainer only" on public.plan_templates
  for all to authenticated
  using ((select private.is_trainer())) with check ((select private.is_trainer()));

-- Starter templates. Each is added once; edits you make later are never overwritten.
insert into public.plan_templates (name, title, notes, days)
select 'Phase 1: Build the Base (4-day Upper/Lower)', 'Phase 1: Build the Base',
  '4 days a week: lift Monday and Tuesday, rest Wednesday, lift Thursday and Friday, and rest on the weekend (easy walks are great). Every session is 45 minutes of lifting, then 30 minutes of Zone 2. Do 3 sets and stop each set with about 2 good reps left. When you hit the top of the rep range on every set, add a little weight next time.',
  $tpl$[{"name": "Mon · Upper A (chest focus)", "items": [{"name": "Barbell or Dumbbell Bench Press", "sets": "3", "reps": "6–10", "rest": "2 min", "note": "", "ref": "chest"}, {"name": "Incline Dumbbell Press", "sets": "3", "reps": "8–12", "rest": "90 sec", "note": "", "ref": "chest"}, {"name": "Pull-Up or Lat Pulldown", "sets": "3", "reps": "8–12", "rest": "90 sec", "note": "", "ref": "back"}, {"name": "Seated Cable Row", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "back"}, {"name": "Dumbbell Lateral Raise", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "shoulders"}, {"name": "Triceps Pushdown", "sets": "2", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "arms"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}, {"name": "Tue · Lower A (quads)", "items": [{"name": "Back Squat or Goblet Squat", "sets": "3", "reps": "8–10", "rest": "2 min", "note": "", "ref": "legs"}, {"name": "Romanian Deadlift", "sets": "3", "reps": "8–10", "rest": "2 min", "note": "", "ref": "legs"}, {"name": "Leg Press", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "legs"}, {"name": "Lying or Seated Leg Curl", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "", "ref": "legs"}, {"name": "Standing Calf Raise", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "legs"}, {"name": "Plank", "sets": "3", "reps": "30–45 sec", "rest": "45 sec", "note": "", "ref": "core"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}, {"name": "Thu · Upper B (back & shoulders)", "items": [{"name": "Seated Dumbbell Shoulder Press", "sets": "3", "reps": "8–10", "rest": "2 min", "note": "", "ref": "shoulders"}, {"name": "Dumbbell Bench Press", "sets": "3", "reps": "8–12", "rest": "90 sec", "note": "", "ref": "full-body"}, {"name": "Single-Arm Dumbbell Row", "sets": "3", "reps": "10–12 per arm", "rest": "90 sec", "note": "", "ref": "back"}, {"name": "Face Pull", "sets": "3", "reps": "15", "rest": "60 sec", "note": "", "ref": "back"}, {"name": "EZ-Bar Curl", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "", "ref": "arms"}, {"name": "Overhead Cable or Dumbbell Triceps Extension", "sets": "2", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "arms"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}, {"name": "Fri · Lower B (glutes & hamstrings)", "items": [{"name": "Barbell Hip Thrust", "sets": "3", "reps": "8–12", "rest": "2 min", "note": "", "ref": "glutes"}, {"name": "Bulgarian Split Squat", "sets": "3", "reps": "8–10 per leg", "rest": "90 sec", "note": "", "ref": "glutes"}, {"name": "Hip Abduction Machine or Banded Walk", "sets": "3", "reps": "15–20", "rest": "60 sec", "note": "", "ref": "glutes"}, {"name": "Lying or Seated Leg Curl", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "", "ref": "legs"}, {"name": "Standing Calf Raise", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "legs"}, {"name": "Dead Bug", "sets": "3", "reps": "8 each side", "rest": "45 sec", "note": "", "ref": "core"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}]$tpl$::jsonb
where not exists (select 1 from public.plan_templates where lower(name) = lower('Phase 1: Build the Base (4-day Upper/Lower)'));

insert into public.plan_templates (name, title, notes, days)
select '3-Day Full Body (beginner / busy / GLP-1)', '3-Day Full Body',
  'Lift Monday, Wednesday and Friday, with a rest day between sessions. Every session is 45 minutes of lifting, then 30 minutes of Zone 2. Do 3 sets and stop each set with about 2 good reps left. When you hit the top of the rep range on every set, add a little weight next time. Three full-body days train every muscle three times a week, which makes this a great fit for beginners, busy schedules, and anyone on a GLP-1 who wants to protect muscle.',
  $tpl$[{"name":"Mon · Full Body A","items":[{"name":"Back Squat or Goblet Squat","sets":"3","reps":"8–10","rest":"2 min","note":"","ref":"legs"},{"name":"Barbell or Dumbbell Bench Press","sets":"3","reps":"6–10","rest":"2 min","note":"","ref":"chest"},{"name":"Seated Cable Row","sets":"3","reps":"10–12","rest":"90 sec","note":"","ref":"back"},{"name":"Dumbbell Lateral Raise","sets":"3","reps":"12–15","rest":"60 sec","note":"","ref":"shoulders"},{"name":"Plank","sets":"3","reps":"30–45 sec","rest":"45 sec","note":"","ref":"core"},{"name":"Zone 2 walk (incline treadmill or outside)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. You can talk in full sentences, but not sing.","ref":""}]},{"name":"Wed · Full Body B","items":[{"name":"Romanian Deadlift","sets":"3","reps":"8–10","rest":"2 min","note":"","ref":"legs"},{"name":"Seated Dumbbell Shoulder Press","sets":"3","reps":"8–10","rest":"2 min","note":"","ref":"shoulders"},{"name":"Pull-Up or Lat Pulldown","sets":"3","reps":"8–12","rest":"90 sec","note":"","ref":"back"},{"name":"Walking Lunge","sets":"3","reps":"10 per leg","rest":"90 sec","note":"","ref":"legs"},{"name":"Dead Bug","sets":"3","reps":"8 each side","rest":"45 sec","note":"","ref":"core"},{"name":"Zone 2 walk (incline treadmill or outside)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. You can talk in full sentences, but not sing.","ref":""}]},{"name":"Fri · Full Body C","items":[{"name":"Barbell Hip Thrust","sets":"3","reps":"8–12","rest":"2 min","note":"","ref":"glutes"},{"name":"Incline Dumbbell Press","sets":"3","reps":"8–12","rest":"90 sec","note":"","ref":"chest"},{"name":"Single-Arm Dumbbell Row","sets":"3","reps":"10–12 per arm","rest":"90 sec","note":"","ref":"back"},{"name":"Leg Press","sets":"3","reps":"10–12","rest":"90 sec","note":"","ref":"legs"},{"name":"Face Pull","sets":"3","reps":"15","rest":"60 sec","note":"","ref":"back"},{"name":"Zone 2 walk (incline treadmill or outside)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. You can talk in full sentences, but not sing.","ref":""}]}]$tpl$::jsonb
where not exists (select 1 from public.plan_templates where lower(name) = lower('3-Day Full Body (beginner / busy / GLP-1)'));

insert into public.plan_templates (name, title, notes, days)
select 'Phase 2: Strength & Size (4-day Upper/Lower)', 'Phase 2: Strength & Size',
  'The next step after Phase 1, usually after 8–12 weeks. Lift Monday, Tuesday, Thursday and Friday. The first lift each day is your main lift: 4 heavy sets with full rest. Everything else is 3 sets. Stop each set with 1–2 good reps left. When you get the top of the rep range on every set of a main lift, add 5 lb next time. Every 6th week, do half the sets to recover (a deload week), then keep building. 30 minutes of Zone 2 after every session.',
  $tpl$[{"name":"Mon · Upper A (strength)","items":[{"name":"Barbell or Dumbbell Bench Press","sets":"4","reps":"5–8","rest":"3 min","note":"Main lift. Add 5 lb when you hit 8 on every set.","ref":"chest"},{"name":"Pull-Up or Lat Pulldown","sets":"4","reps":"6–10","rest":"2 min","note":"","ref":"back"},{"name":"Incline Dumbbell Press","sets":"3","reps":"8–12","rest":"90 sec","note":"","ref":"chest"},{"name":"Barbell or Dumbbell Row","sets":"3","reps":"8–10","rest":"2 min","note":"","ref":"back"},{"name":"Dumbbell Lateral Raise","sets":"3","reps":"12–15","rest":"60 sec","note":"","ref":"shoulders"},{"name":"EZ-Bar Curl","sets":"3","reps":"10–12","rest":"60 sec","note":"","ref":"arms"},{"name":"Zone 2 walk (incline treadmill or outside)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. You can talk in full sentences, but not sing.","ref":""}]},{"name":"Tue · Lower A (strength)","items":[{"name":"Back Squat or Goblet Squat","sets":"4","reps":"5–8","rest":"3 min","note":"Main lift. Add 5 lb when you hit 8 on every set.","ref":"legs"},{"name":"Romanian Deadlift","sets":"3","reps":"6–10","rest":"2 min","note":"","ref":"legs"},{"name":"Leg Press","sets":"3","reps":"10–12","rest":"90 sec","note":"","ref":"legs"},{"name":"Lying or Seated Leg Curl","sets":"3","reps":"10–12","rest":"60 sec","note":"","ref":"legs"},{"name":"Standing Calf Raise","sets":"4","reps":"10–15","rest":"60 sec","note":"","ref":"legs"},{"name":"Hanging or Captain's Chair Knee Raise","sets":"3","reps":"10–15","rest":"60 sec","note":"","ref":"core"},{"name":"Zone 2 walk (incline treadmill or outside)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. You can talk in full sentences, but not sing.","ref":""}]},{"name":"Thu · Upper B (size)","items":[{"name":"Seated Dumbbell Shoulder Press","sets":"4","reps":"6–10","rest":"2 min","note":"Main lift. Go up in weight when you hit 10 on every set.","ref":"shoulders"},{"name":"Single-Arm Dumbbell Row","sets":"4","reps":"8–12 per arm","rest":"90 sec","note":"","ref":"back"},{"name":"Machine or Weighted Dip","sets":"3","reps":"8–12","rest":"90 sec","note":"","ref":"chest"},{"name":"Cable or Dumbbell Fly","sets":"3","reps":"12–15","rest":"60 sec","note":"","ref":"chest"},{"name":"Face Pull","sets":"3","reps":"15","rest":"60 sec","note":"","ref":"back"},{"name":"Overhead Cable or Dumbbell Triceps Extension","sets":"3","reps":"10–12","rest":"60 sec","note":"","ref":"arms"},{"name":"Zone 2 walk (incline treadmill or outside)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. You can talk in full sentences, but not sing.","ref":""}]},{"name":"Fri · Lower B (size)","items":[{"name":"Barbell Hip Thrust","sets":"4","reps":"6–10","rest":"2 min","note":"Main lift. Pause 1 second at the top.","ref":"glutes"},{"name":"Bulgarian Split Squat","sets":"3","reps":"8–10 per leg","rest":"90 sec","note":"","ref":"glutes"},{"name":"Lying or Seated Leg Curl","sets":"3","reps":"10–12","rest":"60 sec","note":"","ref":"legs"},{"name":"Standing Calf Raise","sets":"3","reps":"12–15","rest":"60 sec","note":"","ref":"legs"},{"name":"Cable Woodchop","sets":"3","reps":"10–12 each side","rest":"45 sec","note":"","ref":"core"},{"name":"Zone 2 walk (incline treadmill or outside)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. You can talk in full sentences, but not sing.","ref":""}]}]$tpl$::jsonb
where not exists (select 1 from public.plan_templates where lower(name) = lower('Phase 2: Strength & Size (4-day Upper/Lower)'));

insert into public.plan_templates (name, title, notes, days)
select '3-Day Home Program (dumbbells)', '3-Day Home Program',
  'Monday, Wednesday and Friday at home. All you need is a pair of dumbbells (or water jugs or a loaded backpack) and a sturdy chair. Do 3 sets and stop each set with about 2 good reps left. When the top of the rep range feels easy, add weight or slow the lowering to 3 seconds. Then walk briskly outside for 30 minutes (Zone 2).',
  $tpl$[{"name":"Mon · Full Body A","items":[{"name":"Bodyweight Squat","sets":"3","reps":"15–20","rest":"90 sec","note":"Hold a dumbbell at your chest once 20 reps feels easy.","ref":"legs/home"},{"name":"Push-Up","sets":"3","reps":"8–15","rest":"90 sec","note":"","ref":"chest/home"},{"name":"Bent-Over Row","sets":"3","reps":"10–15","rest":"90 sec","note":"","ref":"back/home"},{"name":"Shoulder Press","sets":"3","reps":"10–12","rest":"90 sec","note":"","ref":"shoulders/home"},{"name":"Plank","sets":"3","reps":"30–60 sec","rest":"45 sec","note":"","ref":"core/home"},{"name":"Zone 2 walk (outside or treadmill)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. You can talk in full sentences, but not sing.","ref":""}]},{"name":"Wed · Full Body B","items":[{"name":"Reverse Lunge","sets":"3","reps":"10 per leg","rest":"90 sec","note":"","ref":"legs/home"},{"name":"Backpack Romanian Deadlift","sets":"3","reps":"10–12","rest":"90 sec","note":"","ref":"back/home"},{"name":"Table Inverted Row","sets":"3","reps":"6–12","rest":"90 sec","note":"","ref":"back/home"},{"name":"Chair Dip","sets":"3","reps":"8–15","rest":"60 sec","note":"","ref":"arms/home"},{"name":"Lateral Raise","sets":"3","reps":"12–20","rest":"60 sec","note":"","ref":"shoulders/home"},{"name":"Dead Bug","sets":"3","reps":"8 each side","rest":"45 sec","note":"","ref":"core/home"},{"name":"Zone 2 walk (outside or treadmill)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. You can talk in full sentences, but not sing.","ref":""}]},{"name":"Fri · Full Body C","items":[{"name":"Single-Leg Glute Bridge","sets":"3","reps":"10–12 per leg","rest":"60 sec","note":"","ref":"glutes/home"},{"name":"Step-Up","sets":"3","reps":"10 per leg","rest":"90 sec","note":"","ref":"legs/home"},{"name":"Wide Push-Up","sets":"3","reps":"8–12","rest":"60 sec","note":"","ref":"chest/home"},{"name":"Bent-Over Rear Delt Raise","sets":"3","reps":"15","rest":"60 sec","note":"","ref":"shoulders/home"},{"name":"Biceps Curl","sets":"3","reps":"10–15","rest":"60 sec","note":"","ref":"arms/home"},{"name":"Side Plank","sets":"3","reps":"20–40 sec each","rest":"45 sec","note":"","ref":"core/home"},{"name":"Zone 2 walk (outside or treadmill)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. You can talk in full sentences, but not sing.","ref":""}]}]$tpl$::jsonb
where not exists (select 1 from public.plan_templates where lower(name) = lower('3-Day Home Program (dumbbells)'));

insert into public.plan_templates (name, title, notes, days)
select 'Glute & Lower Focus (4-day)', 'Glute & Lower Focus',
  'Two lower-body days built around the glutes, plus two upper-body days so the whole body stays strong and balanced. Lift Monday, Tuesday, Thursday and Friday. Hip thrusts and Romanian deadlifts drive glute growth, so push them hard with good form. Stop each set with about 2 good reps left, and add weight when you hit the top of the range on every set. 30 minutes of Zone 2 after every session.',
  $tpl$[{"name":"Mon · Lower A (glutes)","items":[{"name":"Barbell Hip Thrust","sets":"4","reps":"8–12","rest":"2 min","note":"Pause 1 second at the top and squeeze.","ref":"glutes"},{"name":"Back Squat or Goblet Squat","sets":"3","reps":"8–10","rest":"2 min","note":"","ref":"legs"},{"name":"Bulgarian Split Squat","sets":"3","reps":"8–10 per leg","rest":"90 sec","note":"","ref":"glutes"},{"name":"Hip Abduction Machine or Banded Walk","sets":"3","reps":"15–20","rest":"60 sec","note":"","ref":"glutes"},{"name":"Cable Kickback","sets":"3","reps":"12–15 per leg","rest":"60 sec","note":"","ref":"glutes"},{"name":"Zone 2 walk (incline treadmill or outside)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. You can talk in full sentences, but not sing.","ref":""}]},{"name":"Tue · Upper A","items":[{"name":"Pull-Up or Lat Pulldown","sets":"3","reps":"8–12","rest":"90 sec","note":"","ref":"back"},{"name":"Seated Dumbbell Shoulder Press","sets":"3","reps":"8–10","rest":"2 min","note":"","ref":"shoulders"},{"name":"Seated Cable Row","sets":"3","reps":"10–12","rest":"90 sec","note":"","ref":"back"},{"name":"Incline Dumbbell Press","sets":"3","reps":"8–12","rest":"90 sec","note":"","ref":"chest"},{"name":"Dumbbell Lateral Raise","sets":"3","reps":"12–15","rest":"60 sec","note":"","ref":"shoulders"},{"name":"Zone 2 walk (incline treadmill or outside)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. You can talk in full sentences, but not sing.","ref":""}]},{"name":"Thu · Lower B (glutes & hamstrings)","items":[{"name":"Romanian Deadlift","sets":"4","reps":"8–10","rest":"2 min","note":"","ref":"legs"},{"name":"Barbell Hip Thrust","sets":"3","reps":"10–15","rest":"90 sec","note":"Lighter than Monday. Slow, controlled reps.","ref":"glutes"},{"name":"Walking Lunge","sets":"3","reps":"10 per leg","rest":"90 sec","note":"","ref":"legs"},{"name":"Lying or Seated Leg Curl","sets":"3","reps":"10–12","rest":"60 sec","note":"","ref":"legs"},{"name":"Standing Calf Raise","sets":"3","reps":"12–15","rest":"60 sec","note":"","ref":"legs"},{"name":"Zone 2 walk (incline treadmill or outside)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. You can talk in full sentences, but not sing.","ref":""}]},{"name":"Fri · Upper B + glute finisher","items":[{"name":"Single-Arm Dumbbell Row","sets":"3","reps":"10–12 per arm","rest":"90 sec","note":"","ref":"back"},{"name":"Dumbbell Bench Press","sets":"3","reps":"8–12","rest":"90 sec","note":"","ref":"full-body"},{"name":"Face Pull","sets":"3","reps":"15","rest":"60 sec","note":"","ref":"back"},{"name":"Triceps Pushdown","sets":"2","reps":"12–15","rest":"60 sec","note":"","ref":"arms"},{"name":"Hammer Curl","sets":"2","reps":"12","rest":"60 sec","note":"","ref":"arms"},{"name":"Hip Abduction Machine or Banded Walk","sets":"2","reps":"20","rest":"45 sec","note":"Finisher: go until it burns.","ref":"glutes"},{"name":"Zone 2 walk (incline treadmill or outside)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. You can talk in full sentences, but not sing.","ref":""}]}]$tpl$::jsonb
where not exists (select 1 from public.plan_templates where lower(name) = lower('Glute & Lower Focus (4-day)'));

insert into public.plan_templates (name, title, notes, days)
select 'Strong at Any Age (3-day gym, 50+ beginner)', 'Strong at Any Age',
  'Monday, Wednesday and Friday, about 45 minutes of strength and then a 30-minute walk. Weeks 1–4: do 2 sets of each exercise. From week 5: do 3 sets. Pick a weight that feels challenging by the last few reps, and stop with 2–3 reps left. It should never hurt. When you can do the top of the rep range on every set, add a few reps first, then a little weight. Rest as long as you need between sets, usually 1–2 minutes. Showing up 3 times a week matters more than any single workout.',
  $tpl$[{"name":"Mon · Full Body A","items":[{"name":"Back Squat or Goblet Squat","sets":"2","reps":"10–12","rest":"2 min","note":"Goblet squat to a bench: sit down lightly, then stand up tall.","ref":"legs"},{"name":"Dumbbell Bench Press","sets":"2","reps":"10–12","rest":"90 sec","note":"","ref":"full-body"},{"name":"Pull-Up or Lat Pulldown","sets":"2","reps":"10–12","rest":"90 sec","note":"Use the lat pulldown machine.","ref":"back"},{"name":"Lying or Seated Leg Curl","sets":"2","reps":"12–15","rest":"60 sec","note":"Seated leg curl machine.","ref":"legs"},{"name":"Farmer's Carry","sets":"2","reps":"30 sec","rest":"60 sec","note":"Medium dumbbells, tall posture, slow steps.","ref":"full-body"},{"name":"Single-Leg Balance","sets":"2","reps":"20–30 sec each leg","rest":"30 sec","note":"Stand next to a counter and hold it lightly. Let go as you get steadier.","ref":""},{"name":"Zone 2 walk (treadmill or outside)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. Brisk, but you can still talk in full sentences.","ref":""}]},{"name":"Wed · Full Body B","items":[{"name":"Leg Press","sets":"2","reps":"10–15","rest":"2 min","note":"Feet shoulder-width. Go only as deep as feels comfortable for your knees and lower back.","ref":"legs"},{"name":"Seated Cable Row","sets":"2","reps":"10–12","rest":"90 sec","note":"","ref":"back"},{"name":"Seated Dumbbell Shoulder Press","sets":"2","reps":"10–12","rest":"90 sec","note":"Light dumbbells, back against the bench.","ref":"shoulders"},{"name":"Glute Bridge","sets":"2","reps":"12–15","rest":"60 sec","note":"","ref":"glutes/home"},{"name":"Standing Calf Raise","sets":"2","reps":"12–15","rest":"60 sec","note":"Hold the rail for balance.","ref":"legs"},{"name":"Plank","sets":"2","reps":"20–30 sec","rest":"45 sec","note":"Knees down is fine to start.","ref":"core"},{"name":"Zone 2 walk (treadmill or outside)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. Brisk, but you can still talk in full sentences.","ref":""}]},{"name":"Fri · Full Body C","items":[{"name":"Romanian Deadlift","sets":"2","reps":"10–12","rest":"2 min","note":"Light dumbbells. Hips back, flat back, stop at mid-shin.","ref":"legs"},{"name":"Incline Dumbbell Press","sets":"2","reps":"10–12","rest":"90 sec","note":"","ref":"chest"},{"name":"Single-Arm Dumbbell Row","sets":"2","reps":"10–12 per arm","rest":"90 sec","note":"Brace one hand and knee on a bench.","ref":"back"},{"name":"Step-Up","sets":"2","reps":"8–10 per leg","rest":"90 sec","note":"Low step (6–8 in) and hold the rail.","ref":"legs/home"},{"name":"Hip Abduction Machine or Banded Walk","sets":"2","reps":"15","rest":"60 sec","note":"","ref":"glutes"},{"name":"Dead Bug","sets":"2","reps":"6–8 each side","rest":"45 sec","note":"","ref":"core"},{"name":"Zone 2 walk (treadmill or outside)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. Brisk, but you can still talk in full sentences.","ref":""}]}]$tpl$::jsonb
where not exists (select 1 from public.plan_templates where lower(name) = lower('Strong at Any Age (3-day gym, 50+ beginner)'));

insert into public.plan_templates (name, title, notes, days)
select 'Strong at Any Age (3-day home, 50+ beginner)', 'Strong at Any Age: Home',
  'Monday, Wednesday and Friday at home, about 30–40 minutes, then a 30-minute walk. You need a sturdy chair, a counter, and a pair of light dumbbells (or water jugs). Weeks 1–4: do 2 sets. From week 5: do 3 sets. Stop each set with 2–3 reps left. It should never hurt. When an exercise feels easy at the top of the rep range, add reps, slow the lowering to 3 seconds, or use a little more weight.',
  $tpl$[{"name":"Mon · Full Body A","items":[{"name":"Sit-to-Stand (chair squat)","sets":"2","reps":"10–12","rest":"90 sec","note":"Sit down lightly on a sturdy chair, then stand up tall without using your hands. Hold a dumbbell at your chest when it gets easy.","ref":""},{"name":"Incline Push-Up Burnout","sets":"2","reps":"8–12","rest":"90 sec","note":"Hands on the kitchen counter.","ref":"chest/home"},{"name":"Bent-Over Row","sets":"2","reps":"10–12","rest":"90 sec","note":"Light dumbbells or a loaded backpack.","ref":"back/home"},{"name":"Glute Bridge","sets":"2","reps":"12–15","rest":"60 sec","note":"","ref":"glutes/home"},{"name":"Single-Leg Balance","sets":"2","reps":"20–30 sec each leg","rest":"30 sec","note":"Stand next to a counter and hold it lightly. Let go as you get steadier.","ref":""},{"name":"Zone 2 walk (treadmill or outside)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. Brisk, but you can still talk in full sentences.","ref":""}]},{"name":"Wed · Full Body B","items":[{"name":"Step-Up","sets":"2","reps":"8–10 per leg","rest":"90 sec","note":"Use the bottom stair and hold the rail.","ref":"legs/home"},{"name":"Shoulder Press","sets":"2","reps":"10–12","rest":"90 sec","note":"Light dumbbells or water bottles. Sit if that feels steadier.","ref":"shoulders/home"},{"name":"Backpack Romanian Deadlift","sets":"2","reps":"10–12","rest":"90 sec","note":"Light weight. Hips back, flat back.","ref":"back/home"},{"name":"Dead Bug","sets":"2","reps":"6–8 each side","rest":"45 sec","note":"","ref":"core/home"},{"name":"Suitcase Carry","sets":"2","reps":"30 sec each side","rest":"60 sec","note":"Hold one dumbbell or a loaded bag at your side, walk tall without leaning. Switch hands.","ref":""},{"name":"Zone 2 walk (treadmill or outside)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. Brisk, but you can still talk in full sentences.","ref":""}]},{"name":"Fri · Full Body C","items":[{"name":"Sit-to-Stand (chair squat)","sets":"2","reps":"10–15","rest":"90 sec","note":"Slow and controlled: 3 seconds down, then stand up tall.","ref":""},{"name":"Biceps Curl","sets":"2","reps":"10–12","rest":"60 sec","note":"","ref":"arms/home"},{"name":"Lateral Raise","sets":"2","reps":"12–15","rest":"60 sec","note":"Very light weight. Stop at shoulder height.","ref":"shoulders/home"},{"name":"Single-Leg Glute Bridge","sets":"2","reps":"8–10 per leg","rest":"60 sec","note":"","ref":"glutes/home"},{"name":"Side Plank","sets":"2","reps":"15–30 sec each","rest":"45 sec","note":"Knees bent is perfect to start.","ref":"core/home"},{"name":"Single-Leg Balance","sets":"2","reps":"20–30 sec each leg","rest":"30 sec","note":"Stand next to a counter and hold it lightly. Let go as you get steadier.","ref":""},{"name":"Zone 2 walk (treadmill or outside)","sets":"1","reps":"30 min","rest":"","note":"Right after lifting. Brisk, but you can still talk in full sentences.","ref":""}]}]$tpl$::jsonb
where not exists (select 1 from public.plan_templates where lower(name) = lower('Strong at Any Age (3-day home, 50+ beginner)'));

-- Program: 8-Week Strength Builder (added October 2026). Added once; your edits are never overwritten.
insert into public.plan_templates (name, title, notes, days, program)
select '8-Week Strength Builder (4-day Upper/Lower)', '8-Week Strength Builder',
  $tpl$4 days a week: Monday, Tuesday, Thursday, Friday. Each day is about 45 minutes of lifting, then 30 minutes of Zone 2 (the 45/30 rule). Every muscle gets trained twice a week with 10–16 hard sets, the range research supports for growth. Main lifts get heavier every two weeks; accessories stay close to failure for muscle. Week 7 is a deload, week 8 is PR week.$tpl$,
  $tpl$[{"name": "Mon · Upper A (bench)", "items": [{"name": "Barbell or Dumbbell Bench Press", "sets": "4", "reps": "6–8", "rest": "3 min", "note": "Main lift. Same setup every time: feet planted, shoulder blades pinched.", "ref": "chest", "kind": "main"}, {"name": "Barbell or Dumbbell Row", "sets": "4", "reps": "6–8", "rest": "2–3 min", "note": "", "ref": "back", "kind": "main"}, {"name": "Seated Dumbbell Shoulder Press", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "shoulders", "kind": "acc"}, {"name": "Pull-Up or Lat Pulldown", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "back", "kind": "acc"}, {"name": "Triceps Pushdown", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "", "ref": "arms", "kind": "acc"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}, {"name": "Tue · Lower A (squat)", "items": [{"name": "Back Squat or Goblet Squat", "sets": "4", "reps": "6–8", "rest": "3 min", "note": "Main lift. Brace hard, sit between your hips, drive up.", "ref": "legs", "kind": "main"}, {"name": "Romanian Deadlift", "sets": "4", "reps": "6–8", "rest": "2–3 min", "note": "", "ref": "legs", "kind": "main"}, {"name": "Leg Press", "sets": "3", "reps": "10–12", "rest": "2 min", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Lying or Seated Leg Curl", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Standing Calf Raise", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}, {"name": "Thu · Upper B (press)", "items": [{"name": "Seated Dumbbell Shoulder Press", "sets": "4", "reps": "6–8", "rest": "2–3 min", "note": "Main lift today.", "ref": "shoulders", "kind": "main"}, {"name": "Pull-Up or Lat Pulldown", "sets": "4", "reps": "6–8", "rest": "2–3 min", "note": "", "ref": "back", "kind": "main"}, {"name": "Incline Dumbbell Press", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "chest", "kind": "acc"}, {"name": "Seated Cable Row", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "back", "kind": "acc"}, {"name": "Dumbbell Lateral Raise", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "shoulders", "kind": "acc"}, {"name": "EZ-Bar Curl", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "", "ref": "arms", "kind": "acc"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}, {"name": "Fri · Lower B (hips)", "items": [{"name": "Barbell Hip Thrust", "sets": "4", "reps": "6–8", "rest": "2–3 min", "note": "Main lift. Pause one second at the top.", "ref": "glutes", "kind": "main"}, {"name": "Bulgarian Split Squat", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "Reps are per leg.", "ref": "glutes", "kind": "acc"}, {"name": "Goblet or Back Squat", "sets": "3", "reps": "10–12", "rest": "2 min", "note": "Lighter second squat day. Smooth, controlled reps.", "ref": "legs", "kind": "acc"}, {"name": "Lying or Seated Leg Curl", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Hanging or Captain's Chair Knee Raise", "sets": "3", "reps": "10–15", "rest": "60 sec", "note": "", "ref": "core"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}]$tpl$::jsonb,
  $tpl${"name": "8-Week Strength Builder", "weeks": 8, "daysPerWeek": 4, "phases": [{"from": 1, "to": 2, "name": "Build", "note": "Learn the lifts and find your working weights. Main lifts: stop with about 2 good reps left. Accessories: 1–2 left. When you hit the top of the rep range on every set, add weight next time (about 5 lb upper body, 5–10 lb lower body).", "main": {"sets": 4, "reps": "6–8", "rir": "2", "rest": "2–3 min"}, "acc": {"sets": 3, "reps": "10–12", "rir": "1–2"}}, {"name": "Load", "from": 3, "to": 4, "note": "Heavier: fewer reps, more weight. Keep 2 reps in the tank on main lifts. Push accessories closer to failure.", "main": {"sets": 4, "reps": "5–6", "rir": "2", "rest": "3 min"}, "acc": {"sets": 3, "reps": "8–10", "rir": "1–2"}}, {"name": "Strength", "from": 5, "to": 6, "note": "The heaviest block. 5 sets on the main lifts, 1–2 reps in the tank. Rest the full 3 minutes so every set is strong.", "main": {"sets": 5, "reps": "4–5", "rir": "1–2", "rest": "3 min"}, "acc": {"sets": 3, "reps": "8–10", "rir": "1"}}, {"name": "Deload", "from": 7, "to": 7, "deload": true, "note": "Recovery week. Use about 85–90% of last week's weights and leave plenty in the tank. This is when your body catches up and gets stronger.", "main": {"sets": 3, "reps": "5", "rir": "4", "rest": "2 min"}, "acc": {"sets": 2, "reps": "10", "rir": "3"}}, {"name": "PR week", "from": 8, "to": 8, "peak": true, "note": "Show what you've built. Warm up well, then go for your best sets on the main lifts. Your new records show up in Strength.", "main": {"sets": 3, "reps": "3–5", "rir": "0–1", "rest": "3–4 min"}, "acc": {"sets": 2, "reps": "8–10", "rir": "1"}}]}$tpl$::jsonb
where not exists (select 1 from public.plan_templates where lower(name) = lower('8-Week Strength Builder (4-day Upper/Lower)'));

-- Program: 6-Week Shred & Build (added October 2026). Added once; your edits are never overwritten.
insert into public.plan_templates (name, title, notes, days, program)
select '6-Week Shred & Build (4-day Upper/Lower)', '6-Week Shred & Build',
  $tpl$6 weeks to lose fat and keep (or build) muscle. 4 days a week: Monday, Tuesday, Thursday, Friday, about 45 minutes of lifting, then 30 minutes of Zone 2 (the 45/30 rule). Main lifts stay heavy the whole time, which is what tells your body to hold onto muscle in a calorie deficit. Accessories use higher reps and short rests. Eat in a moderate deficit with high protein: about 0.8–1 g per pound of goal body weight every day, and keep steps at 8,000–10,000.$tpl$,
  $tpl$[{"name": "Mon · Upper A", "items": [{"name": "Dumbbell Bench Press", "sets": "3", "reps": "8–10", "rest": "2 min", "note": "Main lift. Keep the weight heavy even while dieting. It tells your body to keep its muscle.", "ref": "full-body", "kind": "main"}, {"name": "Lat Pulldown or Pull-Up", "sets": "3", "reps": "8–10", "rest": "2 min", "note": "", "ref": "full-body", "kind": "main"}, {"name": "Seated Dumbbell Shoulder Press", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "shoulders", "kind": "acc"}, {"name": "Seated Cable Row", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "back", "kind": "acc"}, {"name": "Cable or Dumbbell Fly", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "chest", "kind": "acc"}, {"name": "Hammer Curl", "sets": "3", "reps": "12–15", "rest": "45 sec", "note": "", "ref": "arms", "kind": "acc"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}, {"name": "Tue · Lower A", "items": [{"name": "Goblet or Back Squat", "sets": "3", "reps": "8–10", "rest": "2 min", "note": "Main lift.", "ref": "full-body", "kind": "main"}, {"name": "Romanian Deadlift", "sets": "3", "reps": "8–10", "rest": "2 min", "note": "", "ref": "legs", "kind": "main"}, {"name": "Walking Lunge", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "Reps are per leg.", "ref": "legs", "kind": "acc"}, {"name": "Lying or Seated Leg Curl", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Standing Calf Raise", "sets": "3", "reps": "12–15", "rest": "45 sec", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Plank", "sets": "3", "reps": "30–60 sec", "rest": "45 sec", "note": "", "ref": "core"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}, {"name": "Thu · Upper B", "items": [{"name": "Incline Dumbbell Press", "sets": "3", "reps": "8–10", "rest": "2 min", "note": "Main lift.", "ref": "chest", "kind": "main"}, {"name": "Single-Arm Dumbbell Row", "sets": "3", "reps": "8–10", "rest": "90 sec", "note": "Reps are per arm.", "ref": "back", "kind": "main"}, {"name": "Dumbbell Lateral Raise", "sets": "3", "reps": "12–15", "rest": "45 sec", "note": "", "ref": "shoulders", "kind": "acc"}, {"name": "Face Pull", "sets": "3", "reps": "12–15", "rest": "45 sec", "note": "", "ref": "back", "kind": "acc"}, {"name": "Overhead Cable or Dumbbell Triceps Extension", "sets": "3", "reps": "12–15", "rest": "45 sec", "note": "", "ref": "arms", "kind": "acc"}, {"name": "EZ-Bar Curl", "sets": "3", "reps": "12–15", "rest": "45 sec", "note": "", "ref": "arms", "kind": "acc"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}, {"name": "Fri · Lower B", "items": [{"name": "Barbell Hip Thrust", "sets": "3", "reps": "8–10", "rest": "2 min", "note": "Main lift. Pause one second at the top.", "ref": "glutes", "kind": "main"}, {"name": "Bulgarian Split Squat", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "Reps are per leg.", "ref": "glutes", "kind": "acc"}, {"name": "Leg Press", "sets": "3", "reps": "12–15", "rest": "90 sec", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Cable Kickback", "sets": "3", "reps": "12–15", "rest": "45 sec", "note": "Reps are per leg.", "ref": "glutes", "kind": "acc"}, {"name": "Dead Bug", "sets": "3", "reps": "8 each side", "rest": "45 sec", "note": "", "ref": "core"}, {"name": "Farmer's Carry", "sets": "3", "reps": "40 yards", "rest": "60 sec", "note": "Heavy dumbbells, tall posture. A great finisher.", "ref": "full-body"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}]$tpl$::jsonb,
  $tpl${"name": "6-Week Shred & Build", "weeks": 6, "daysPerWeek": 4, "phases": [{"from": 1, "to": 2, "name": "Foundation", "note": "Dial in form and weights. Main lifts: stop with 2 good reps left. Accessories: 1–2 left, short rests. Aim for 8,000+ steps a day.", "main": {"sets": 3, "reps": "8–10", "rir": "2", "rest": "2 min"}, "acc": {"sets": 3, "reps": "12–15", "rir": "1–2", "rest": "60 sec"}}, {"from": 3, "to": 4, "name": "Burn", "note": "Main lifts go heavier with an extra set, so you hold onto muscle while the scale drops. Accessories: rest only 45–60 seconds. Push steps to 10,000.", "main": {"sets": 4, "reps": "6–8", "rir": "2", "rest": "2 min"}, "acc": {"sets": 3, "reps": "10–12", "rir": "1", "rest": "45–60 sec"}}, {"from": 5, "to": 5, "name": "Peak", "note": "The hardest week. Main lifts heavy, 1–2 reps in the tank. Take the last set of each accessory close to failure.", "main": {"sets": 4, "reps": "5–6", "rir": "1–2", "rest": "2–3 min"}, "acc": {"sets": 3, "reps": "10–12", "rir": "0–1", "rest": "45–60 sec"}}, {"from": 6, "to": 6, "name": "Finish strong", "peak": true, "note": "Prove you kept (or built) your strength while losing fat: go for your best sets on the main lifts. Take progress photos and a check-in at the end of the week.", "main": {"sets": 3, "reps": "4–6", "rir": "0–1", "rest": "3 min"}, "acc": {"sets": 2, "reps": "10–12", "rir": "1", "rest": "60 sec"}}]}$tpl$::jsonb
where not exists (select 1 from public.plan_templates where lower(name) = lower('6-Week Shred & Build (4-day Upper/Lower)'));

-- Program: 8-Week Muscle Builder (added October 2026). Added once; your edits are never overwritten.
insert into public.plan_templates (name, title, notes, days, program)
select '8-Week Muscle Builder (5-day split)', '8-Week Muscle Builder',
  $tpl$5 days a week: Upper, Lower, Push, Pull, Legs (Mon, Tue, Thu, Fri, Sat), about 45 minutes each, then 30 minutes of Zone 2 (the 45/30 rule). Built for size: every muscle gets 14–20 hard sets a week across two sessions, the top of the range research supports for growth, with sets taken close to failure. Volume builds for six weeks, week 7 is a deload, week 8 is a pump-and-PR finish. Eat at maintenance or a small surplus with about 0.8–1 g of protein per pound.$tpl$,
  $tpl$[{"name": "Mon · Upper", "items": [{"name": "Barbell or Dumbbell Bench Press", "sets": "4", "reps": "6–10", "rest": "2–3 min", "note": "Main lift.", "ref": "chest", "kind": "main"}, {"name": "Barbell or Dumbbell Row", "sets": "4", "reps": "6–10", "rest": "2–3 min", "note": "", "ref": "back", "kind": "main"}, {"name": "Seated Dumbbell Shoulder Press", "sets": "3", "reps": "8–12", "rest": "90 sec", "note": "", "ref": "shoulders", "kind": "acc"}, {"name": "Pull-Up or Lat Pulldown", "sets": "3", "reps": "8–12", "rest": "90 sec", "note": "", "ref": "back", "kind": "acc"}, {"name": "Dumbbell Lateral Raise", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "shoulders", "kind": "acc"}, {"name": "EZ-Bar Curl", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "", "ref": "arms", "kind": "acc"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}, {"name": "Tue · Lower", "items": [{"name": "Back Squat or Goblet Squat", "sets": "4", "reps": "6–10", "rest": "3 min", "note": "Main lift.", "ref": "legs", "kind": "main"}, {"name": "Romanian Deadlift", "sets": "3", "reps": "8–10", "rest": "2–3 min", "note": "", "ref": "legs", "kind": "main"}, {"name": "Leg Press", "sets": "3", "reps": "10–15", "rest": "2 min", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Lying or Seated Leg Curl", "sets": "3", "reps": "10–15", "rest": "90 sec", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Standing Calf Raise", "sets": "4", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Hanging or Captain's Chair Knee Raise", "sets": "3", "reps": "10–15", "rest": "60 sec", "note": "", "ref": "core"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}, {"name": "Thu · Push", "items": [{"name": "Incline Dumbbell Press", "sets": "4", "reps": "8–10", "rest": "2 min", "note": "Main lift.", "ref": "chest", "kind": "main"}, {"name": "Machine or Weighted Dip", "sets": "3", "reps": "8–12", "rest": "90 sec", "note": "", "ref": "chest", "kind": "acc"}, {"name": "Cable or Dumbbell Fly", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "chest", "kind": "acc"}, {"name": "Dumbbell Lateral Raise", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "shoulders", "kind": "acc"}, {"name": "Overhead Cable or Dumbbell Triceps Extension", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "", "ref": "arms", "kind": "acc"}, {"name": "Triceps Pushdown", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "arms", "kind": "acc"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}, {"name": "Fri · Pull", "items": [{"name": "Pull-Up or Lat Pulldown", "sets": "4", "reps": "8–10", "rest": "2 min", "note": "Main lift.", "ref": "back", "kind": "main"}, {"name": "Seated Cable Row", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "back", "kind": "acc"}, {"name": "Single-Arm Dumbbell Row", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "Reps are per arm.", "ref": "back", "kind": "acc"}, {"name": "Face Pull", "sets": "3", "reps": "15", "rest": "60 sec", "note": "", "ref": "back", "kind": "acc"}, {"name": "Rear Delt Fly", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "shoulders", "kind": "acc"}, {"name": "Incline Dumbbell Curl", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "", "ref": "arms", "kind": "acc"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}, {"name": "Sat · Legs & glutes", "items": [{"name": "Barbell Hip Thrust", "sets": "4", "reps": "8–10", "rest": "2 min", "note": "Main lift. Pause one second at the top.", "ref": "glutes", "kind": "main"}, {"name": "Bulgarian Split Squat", "sets": "3", "reps": "8–12", "rest": "90 sec", "note": "Reps are per leg.", "ref": "glutes", "kind": "acc"}, {"name": "Walking Lunge", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "Reps are per leg.", "ref": "legs", "kind": "acc"}, {"name": "Lying or Seated Leg Curl", "sets": "3", "reps": "10–15", "rest": "60 sec", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Hip Abduction Machine or Banded Walk", "sets": "3", "reps": "15–20", "rest": "60 sec", "note": "", "ref": "glutes", "kind": "acc"}, {"name": "Standing Calf Raise", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}]$tpl$::jsonb,
  $tpl${"name": "8-Week Muscle Builder", "weeks": 8, "daysPerWeek": 5, "phases": [{"from": 1, "to": 2, "name": "Accumulate", "note": "Settle into the split. Main lifts: 2 reps in the tank. Accessories: 1–2 in the tank. Write down your weights; next week beat them by a rep or a little weight.", "main": {"sets": 3, "reps": "8–10", "rir": "2", "rest": "2–3 min"}, "acc": {"sets": 3, "reps": "10–15", "rir": "1–2"}}, {"from": 3, "to": 4, "name": "Build", "note": "An extra set on everything. This is where most of the growth comes from: lots of hard sets close to failure.", "main": {"sets": 4, "reps": "8–10", "rir": "1–2", "rest": "2–3 min"}, "acc": {"sets": 4, "reps": "10–12", "rir": "1"}}, {"from": 5, "to": 6, "name": "Intensify", "note": "Heavier main lifts, and take the last set of each accessory to failure (machines and dumbbells, never with a barbell on your back).", "main": {"sets": 4, "reps": "6–8", "rir": "1–2", "rest": "3 min"}, "acc": {"sets": 4, "reps": "8–12", "rir": "0–1"}}, {"from": 7, "to": 7, "name": "Deload", "note": "Recovery week. Half the sets, about 85–90% of last week's weights, plenty in the tank. Muscles grow while you recover.", "main": {"sets": 2, "reps": "8", "rir": "3–4", "rest": "2 min"}, "acc": {"sets": 2, "reps": "12", "rir": "3"}, "deload": true}, {"from": 8, "to": 8, "name": "Pump & PR", "note": "Finish big: best sets on the main lifts, high-rep pump sets on accessories. Take progress photos at the end of the week.", "main": {"sets": 3, "reps": "6–8", "rir": "0–1", "rest": "3 min"}, "acc": {"sets": 3, "reps": "12–15", "rir": "0–1"}, "peak": true}]}$tpl$::jsonb
where not exists (select 1 from public.plan_templates where lower(name) = lower('8-Week Muscle Builder (5-day split)'));

-- Program: 6-Week Strong at Any Age (added October 2026). Added once; your edits are never overwritten.
insert into public.plan_templates (name, title, notes, days, program)
select '6-Week Strong at Any Age (50+, 3-day gym)', '6-Week Strong at Any Age',
  $tpl$Monday, Wednesday and Friday: about 45 minutes of strength, then a 30-minute walk. Built for adults 50+: full body three times a week, which research shows builds strength, muscle and bone at any age. You never train to failure here. Every set stops with 2–3 reps left, and weights go up slowly and only when the reps feel solid. Rest as long as you need between sets. It should never hurt.$tpl$,
  $tpl$[{"name": "Mon · Full Body A", "items": [{"name": "Back Squat or Goblet Squat", "sets": "2", "reps": "10–12", "rest": "2 min", "note": "Goblet squat to a bench: sit down lightly, then stand up tall.", "ref": "legs", "kind": "main"}, {"name": "Dumbbell Bench Press", "sets": "2", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "full-body", "kind": "main"}, {"name": "Pull-Up or Lat Pulldown", "sets": "2", "reps": "10–12", "rest": "90 sec", "note": "Use the lat pulldown machine.", "ref": "back", "kind": "acc"}, {"name": "Lying or Seated Leg Curl", "sets": "2", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Farmer's Carry", "sets": "2", "reps": "30 sec", "rest": "60 sec", "note": "Medium dumbbells, tall posture, slow steps.", "ref": "full-body"}, {"name": "Single-Leg Balance", "sets": "2", "reps": "20–30 sec each leg", "rest": "30 sec", "note": "Stand next to a counter and hold it lightly. Let go as you get steadier.", "ref": ""}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}, {"name": "Wed · Full Body B", "items": [{"name": "Leg Press", "sets": "2", "reps": "10–15", "rest": "2 min", "note": "Feet shoulder-width. Only as deep as feels comfortable for your knees and lower back.", "ref": "legs", "kind": "main"}, {"name": "Seated Cable Row", "sets": "2", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "back", "kind": "main"}, {"name": "Seated Dumbbell Shoulder Press", "sets": "2", "reps": "10–12", "rest": "90 sec", "note": "Light dumbbells, back against the bench.", "ref": "shoulders", "kind": "acc"}, {"name": "Glute Bridge", "sets": "2", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "glutes/home", "kind": "acc"}, {"name": "Standing Calf Raise", "sets": "2", "reps": "12–15", "rest": "60 sec", "note": "Hold the rail for balance.", "ref": "legs", "kind": "acc"}, {"name": "Plank", "sets": "2", "reps": "20–30 sec", "rest": "45 sec", "note": "Knees down is fine to start.", "ref": "core"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}, {"name": "Fri · Full Body C", "items": [{"name": "Romanian Deadlift", "sets": "2", "reps": "10–12", "rest": "2 min", "note": "Light dumbbells. Hips back, flat back, stop at mid-shin.", "ref": "legs", "kind": "main"}, {"name": "Incline Dumbbell Press", "sets": "2", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "chest", "kind": "main"}, {"name": "Single-Arm Dumbbell Row", "sets": "2", "reps": "10–12", "rest": "90 sec", "note": "Brace one hand and knee on a bench. Reps are per arm.", "ref": "back", "kind": "acc"}, {"name": "Step-Up", "sets": "2", "reps": "8–10", "rest": "90 sec", "note": "Low step (6–8 in) and hold the rail. Reps are per leg.", "ref": "legs/home", "kind": "acc"}, {"name": "Hip Abduction Machine or Banded Walk", "sets": "2", "reps": "15", "rest": "60 sec", "note": "", "ref": "glutes", "kind": "acc"}, {"name": "Dead Bug", "sets": "2", "reps": "6–8 each side", "rest": "45 sec", "note": "", "ref": "core"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after lifting. You can talk in full sentences, but not sing.", "ref": ""}]}]$tpl$::jsonb,
  $tpl${"name": "6-Week Strong at Any Age", "weeks": 6, "daysPerWeek": 3, "phases": [{"from": 1, "to": 2, "name": "Learn", "note": "Two sets of each exercise. Pick weights you could lift 3 more times. Focus on smooth, controlled reps and good posture.", "main": {"sets": 2, "reps": "10–12", "rir": "3", "rest": "2 min"}, "acc": {"sets": 2, "reps": "12–15", "rir": "3"}}, {"from": 3, "to": 4, "name": "Build", "note": "Main lifts get a third set. When the top of the rep range feels easy on every set, add a little weight (2.5–5 lb) next time.", "main": {"sets": 3, "reps": "10–12", "rir": "2–3", "rest": "2 min"}, "acc": {"sets": 2, "reps": "12–15", "rir": "2–3"}}, {"from": 5, "to": 6, "name": "Strengthen", "note": "Slightly heavier main lifts with fewer reps, still 2 reps in the tank. You should feel stronger walking, carrying and getting up from a chair.", "main": {"sets": 3, "reps": "8–10", "rir": "2", "rest": "2 min"}, "acc": {"sets": 3, "reps": "10–12", "rir": "2"}}]}$tpl$::jsonb
where not exists (select 1 from public.plan_templates where lower(name) = lower('6-Week Strong at Any Age (50+, 3-day gym)'));

-- Program: 6-Week Home Dumbbell (added October 2026). Added once; your edits are never overwritten.
insert into public.plan_templates (name, title, notes, days, program)
select '6-Week Home Dumbbell (4-day)', '6-Week Home Dumbbell',
  $tpl$4 days a week at home: Monday, Tuesday, Thursday, Friday. All you need is a pair of dumbbells (or water jugs, a backpack) and a sturdy chair, about 40 minutes, then a 30-minute walk. With lighter weights, the program makes sets harder other ways: more reps, slower lowering (3 seconds down), pauses and shorter rests. Research shows lighter weights build muscle just as well when sets are taken close to failure.$tpl$,
  $tpl$[{"name": "Mon · Upper A", "items": [{"name": "Push-Up", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "Hands on a counter to make it easier, feet on a chair to make it harder.", "ref": "chest/home", "kind": "main"}, {"name": "Single-Arm Dumbbell Row", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "Brace one hand on a chair. Reps are per arm.", "ref": "back", "kind": "main"}, {"name": "Shoulder Press", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "shoulders/home", "kind": "acc"}, {"name": "Table Inverted Row", "sets": "3", "reps": "8–12", "rest": "60 sec", "note": "", "ref": "back/home", "kind": "acc"}, {"name": "Lateral Raise", "sets": "3", "reps": "12–15", "rest": "45 sec", "note": "", "ref": "shoulders/home", "kind": "acc"}, {"name": "Biceps Curl", "sets": "3", "reps": "12–15", "rest": "45 sec", "note": "", "ref": "arms/home", "kind": "acc"}, {"name": "Zone 2 walk (outside or treadmill)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after your workout. Brisk, but you can still talk in full sentences.", "ref": ""}]}, {"name": "Tue · Lower A", "items": [{"name": "Bodyweight Squat", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "Hold a dumbbell at your chest (goblet). 3 seconds down.", "ref": "legs/home", "kind": "main"}, {"name": "Backpack Romanian Deadlift", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "Dumbbells or a loaded backpack.", "ref": "back/home", "kind": "main"}, {"name": "Reverse Lunge", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "Reps are per leg.", "ref": "legs/home", "kind": "acc"}, {"name": "Single-Leg Glute Bridge", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "Reps are per leg.", "ref": "glutes/home", "kind": "acc"}, {"name": "Single-Leg Calf Raise", "sets": "3", "reps": "12–15", "rest": "45 sec", "note": "Reps are per leg.", "ref": "legs/home", "kind": "acc"}, {"name": "Dead Bug", "sets": "3", "reps": "8 each side", "rest": "45 sec", "note": "", "ref": "core/home"}, {"name": "Zone 2 walk (outside or treadmill)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after your workout. Brisk, but you can still talk in full sentences.", "ref": ""}]}, {"name": "Thu · Upper B", "items": [{"name": "Decline Push-Up", "sets": "3", "reps": "8–12", "rest": "90 sec", "note": "Feet on a chair.", "ref": "chest/home", "kind": "main"}, {"name": "Bent-Over Row", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "back/home", "kind": "main"}, {"name": "Chair Dip", "sets": "3", "reps": "10–15", "rest": "60 sec", "note": "", "ref": "arms/home", "kind": "acc"}, {"name": "Bent-Over Rear Delt Raise", "sets": "3", "reps": "15", "rest": "45 sec", "note": "", "ref": "shoulders/home", "kind": "acc"}, {"name": "Hammer Curl", "sets": "3", "reps": "12–15", "rest": "45 sec", "note": "", "ref": "arms/home", "kind": "acc"}, {"name": "Triceps Kickback", "sets": "3", "reps": "12–15", "rest": "45 sec", "note": "", "ref": "arms/home", "kind": "acc"}, {"name": "Zone 2 walk (outside or treadmill)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after your workout. Brisk, but you can still talk in full sentences.", "ref": ""}]}, {"name": "Fri · Lower B", "items": [{"name": "Couch Bulgarian Split Squat", "sets": "3", "reps": "8–12", "rest": "90 sec", "note": "Back foot on the couch. Hold dumbbells when bodyweight is easy. Reps are per leg.", "ref": "glutes/home", "kind": "main"}, {"name": "Single-Leg Romanian Deadlift", "sets": "3", "reps": "8–10", "rest": "90 sec", "note": "Reps are per leg. Hold the wall lightly for balance.", "ref": "legs/home", "kind": "main"}, {"name": "Step-Up", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "Use the bottom stair or a sturdy step. Reps are per leg.", "ref": "legs/home", "kind": "acc"}, {"name": "Glute Bridge", "sets": "3", "reps": "15–20", "rest": "45 sec", "note": "", "ref": "glutes/home", "kind": "acc"}, {"name": "Side Plank", "sets": "3", "reps": "20–40 sec each", "rest": "30 sec", "note": "", "ref": "core/home"}, {"name": "Mountain Climbers", "sets": "3", "reps": "30 sec", "rest": "30 sec", "note": "", "ref": "core/home"}, {"name": "Zone 2 walk (outside or treadmill)", "sets": "1", "reps": "30 min", "rest": "", "note": "Right after your workout. Brisk, but you can still talk in full sentences.", "ref": ""}]}]$tpl$::jsonb,
  $tpl${"name": "6-Week Home Dumbbell", "weeks": 6, "daysPerWeek": 4, "phases": [{"from": 1, "to": 2, "name": "Foundation", "note": "Learn every move with good form. Stop each set with 2 reps left. Note your reps and weights so you can beat them.", "main": {"sets": 3, "reps": "10–12", "rir": "2", "rest": "90 sec"}, "acc": {"sets": 3, "reps": "12–15", "rir": "2", "rest": "60 sec"}}, {"from": 3, "to": 4, "name": "Tempo", "note": "Make light weights feel heavy: lower every rep for 3 seconds. Main moves get a fourth set.", "main": {"sets": 4, "reps": "8–12", "rir": "1–2", "rest": "90 sec"}, "acc": {"sets": 3, "reps": "12–15", "rir": "1", "rest": "45–60 sec"}}, {"from": 5, "to": 5, "name": "Pause", "note": "Add a 1-second pause at the hardest point of every rep (bottom of the squat, chest near the floor). Take accessories close to failure.", "main": {"sets": 4, "reps": "8–12", "rir": "1", "rest": "90 sec"}, "acc": {"sets": 3, "reps": "15–20", "rir": "0–1", "rest": "45 sec"}}, {"from": 6, "to": 6, "name": "Test", "note": "Best quality reps on the main moves. Compare with week 1: more reps or heavier dumbbells means you got stronger.", "main": {"sets": 3, "reps": "max good reps", "rir": "0–1", "rest": "2 min"}, "acc": {"sets": 2, "reps": "15–20", "rir": "1", "rest": "60 sec"}, "peak": true}]}$tpl$::jsonb
where not exists (select 1 from public.plan_templates where lower(name) = lower('6-Week Home Dumbbell (4-day)'));

-- Program: 10-Week Mass Builder (added October 2026). Added once; your edits are never overwritten.
insert into public.plan_templates (name, title, notes, days, program)
select '10-Week Mass Builder (5-day PPL + Upper/Lower)', '10-Week Mass Builder',
  $tpl$Serious size, 5 days a week: Push, Pull and Lower posterior (Thursday to Saturday), rest Sunday, Upper and Lower quads (Monday and Tuesday), rest Wednesday. Every muscle is trained twice a week with 16–22 hard sets at the peak, about an hour each session, plus a short easy walk. It only works with food: eat in a 250–500 calorie surplus with about 0.8–1 g of protein per pound, sleep 7–9 hours, and aim to gain about 0.25–0.5% of body weight per week. Volume builds for 6 weeks, week 7 is a deload, weeks 8–9 go heavy, week 10 is PR week.$tpl$,
  $tpl$[{"name": "Mon · Upper (shoulders & arms)", "items": [{"name": "Seated Dumbbell Shoulder Press", "sets": "4", "reps": "6–10", "rest": "2–3 min", "note": "Main lift.", "ref": "shoulders", "kind": "main"}, {"name": "Pull-Up or Lat Pulldown", "sets": "4", "reps": "6–10", "rest": "2–3 min", "note": "", "ref": "back", "kind": "main"}, {"name": "Machine or Weighted Dip", "sets": "3", "reps": "8–12", "rest": "90 sec", "note": "", "ref": "chest", "kind": "acc"}, {"name": "Dumbbell Lateral Raise", "sets": "4", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "shoulders", "kind": "acc"}, {"name": "Incline Dumbbell Curl", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "", "ref": "arms", "kind": "acc"}, {"name": "Close-Grip Bench Press", "sets": "3", "reps": "8–12", "rest": "90 sec", "note": "", "ref": "arms", "kind": "acc"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "20–30 min", "rest": "", "note": "After lifting. On a mass phase 20 minutes is enough; keep it easy.", "ref": ""}]}, {"name": "Tue · Lower (quads)", "items": [{"name": "Back Squat or Goblet Squat", "sets": "4", "reps": "6–10", "rest": "3 min", "note": "Main lift. Brace hard, full depth you control.", "ref": "legs", "kind": "main"}, {"name": "Leg Press", "sets": "3", "reps": "10–12", "rest": "2 min", "note": "", "ref": "legs", "kind": "main"}, {"name": "Walking Lunge", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "Reps are per leg.", "ref": "legs", "kind": "acc"}, {"name": "Lying or Seated Leg Curl", "sets": "3", "reps": "10–15", "rest": "60 sec", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Standing Calf Raise", "sets": "4", "reps": "10–15", "rest": "60 sec", "note": "Full stretch at the bottom, 1-second squeeze at the top.", "ref": "legs", "kind": "acc"}, {"name": "Plank", "sets": "3", "reps": "45–60 sec", "rest": "45 sec", "note": "", "ref": "core"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "20–30 min", "rest": "", "note": "After lifting. On a mass phase 20 minutes is enough; keep it easy.", "ref": ""}]}, {"name": "Wed · Rest", "items": [{"name": "Rest day", "sets": "", "reps": "Walk 8,000+ steps", "rest": "", "note": "Recovery is when you grow. Sleep 7–9 hours and hit your protein.", "ref": ""}]}, {"name": "Thu · Push (chest, shoulders, triceps)", "items": [{"name": "Barbell or Dumbbell Bench Press", "sets": "4", "reps": "6–10", "rest": "3 min", "note": "Main lift.", "ref": "chest", "kind": "main"}, {"name": "Incline Dumbbell Press", "sets": "4", "reps": "8–10", "rest": "2 min", "note": "", "ref": "chest", "kind": "main"}, {"name": "Cable or Dumbbell Fly", "sets": "3", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "chest", "kind": "acc"}, {"name": "Dumbbell Lateral Raise", "sets": "4", "reps": "12–15", "rest": "60 sec", "note": "", "ref": "shoulders", "kind": "acc"}, {"name": "Triceps Pushdown", "sets": "3", "reps": "10–15", "rest": "60 sec", "note": "", "ref": "arms", "kind": "acc"}, {"name": "Overhead Cable or Dumbbell Triceps Extension", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "", "ref": "arms", "kind": "acc"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "20–30 min", "rest": "", "note": "After lifting. On a mass phase 20 minutes is enough; keep it easy.", "ref": ""}]}, {"name": "Fri · Pull (back, rear delts, biceps)", "items": [{"name": "Pull-Up or Lat Pulldown", "sets": "4", "reps": "6–10", "rest": "2–3 min", "note": "Main lift.", "ref": "back", "kind": "main"}, {"name": "Barbell or Dumbbell Row", "sets": "4", "reps": "6–10", "rest": "2–3 min", "note": "", "ref": "back", "kind": "main"}, {"name": "Seated Cable Row", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "", "ref": "back", "kind": "acc"}, {"name": "Face Pull", "sets": "3", "reps": "15", "rest": "60 sec", "note": "", "ref": "back", "kind": "acc"}, {"name": "EZ-Bar Curl", "sets": "3", "reps": "8–12", "rest": "60 sec", "note": "", "ref": "arms", "kind": "acc"}, {"name": "Hammer Curl", "sets": "3", "reps": "10–12", "rest": "60 sec", "note": "", "ref": "arms", "kind": "acc"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "20–30 min", "rest": "", "note": "After lifting. On a mass phase 20 minutes is enough; keep it easy.", "ref": ""}]}, {"name": "Sat · Lower (posterior: hamstrings & glutes)", "items": [{"name": "Romanian Deadlift", "sets": "4", "reps": "6–10", "rest": "3 min", "note": "Main lift. Hips back, flat back, feel the hamstrings stretch.", "ref": "legs", "kind": "main"}, {"name": "Barbell Hip Thrust", "sets": "4", "reps": "8–10", "rest": "2 min", "note": "Pause one second at the top.", "ref": "glutes", "kind": "main"}, {"name": "Lying or Seated Leg Curl", "sets": "4", "reps": "10–12", "rest": "60 sec", "note": "", "ref": "legs", "kind": "acc"}, {"name": "Bulgarian Split Squat", "sets": "3", "reps": "8–12", "rest": "90 sec", "note": "Lean forward slightly to bias the glutes. Reps are per leg.", "ref": "glutes", "kind": "acc"}, {"name": "Hip Abduction Machine or Banded Walk", "sets": "3", "reps": "15–20", "rest": "60 sec", "note": "", "ref": "glutes", "kind": "acc"}, {"name": "Hanging or Captain's Chair Knee Raise", "sets": "3", "reps": "10–15", "rest": "60 sec", "note": "", "ref": "core"}, {"name": "Zone 2 walk (incline treadmill or outside)", "sets": "1", "reps": "20–30 min", "rest": "", "note": "After lifting. On a mass phase 20 minutes is enough; keep it easy.", "ref": ""}]}, {"name": "Sun · Rest", "items": [{"name": "Rest day", "sets": "", "reps": "Walk 8,000+ steps", "rest": "", "note": "Full rest. Prep meals for the week.", "ref": ""}]}]$tpl$::jsonb,
  $tpl${"name": "10-Week Mass Builder", "weeks": 10, "daysPerWeek": 5, "phases": [{"from": 1, "to": 3, "name": "Accumulate", "note": "Find your working weights and build the habit. Main lifts: 2 reps in the tank. Accessories: 1–2 in the tank. Beat last week by a rep or a little weight every session.", "main": {"sets": 3, "reps": "8–10", "rir": "2", "rest": "2–3 min"}, "acc": {"sets": 3, "reps": "10–15", "rir": "1–2"}}, {"from": 4, "to": 6, "name": "Overload", "note": "An extra set on everything: 16–22 hard sets per muscle each week, the high end research ties to the most growth. Last set of each accessory to failure (machines and dumbbells only).", "main": {"sets": 4, "reps": "6–10", "rir": "1–2", "rest": "3 min"}, "acc": {"sets": 4, "reps": "10–12", "rir": "0–1"}}, {"from": 7, "to": 7, "name": "Deload", "note": "Recovery week. Half the sets, about 85–90% of last week's weights, plenty in the tank. Keep eating: this week your body builds the muscle.", "main": {"sets": 2, "reps": "8", "rir": "3–4", "rest": "2 min"}, "acc": {"sets": 2, "reps": "12", "rir": "3"}, "deload": true}, {"from": 8, "to": 9, "name": "Intensify", "note": "Heaviest block. Main lifts 5–8 reps, 1 in the tank. On the last accessory set, add one drop set: strip about 25% of the weight and go again to failure.", "main": {"sets": 4, "reps": "5–8", "rir": "1", "rest": "3 min"}, "acc": {"sets": 3, "reps": "8–12", "rir": "0–1"}}, {"from": 10, "to": 10, "name": "PR & pump", "note": "Show the gains: best sets on every main lift, then high-rep pump work. Progress photos, weigh-in and tape at the end of the week.", "main": {"sets": 3, "reps": "5–8", "rir": "0–1", "rest": "3–4 min"}, "acc": {"sets": 3, "reps": "12–20", "rir": "0–1"}, "peak": true}]}$tpl$::jsonb
where not exists (select 1 from public.plan_templates where lower(name) = lower('10-Week Mass Builder (5-day PPL + Upper/Lower)'));

-- Program: 8-Week HYROX Prep (added October 2026). Added once; your edits are never overwritten.
insert into public.plan_templates (name, title, notes, days, program)
select '8-Week HYROX Prep (4-day)', '8-Week HYROX Prep',
  $tpl$HYROX is 8 × 1 km of running, each followed by a station: SkiErg 1000 m, Sled Push 50 m, Sled Pull 50 m, Burpee Broad Jumps 80 m, Row 1000 m, Farmers Carry 200 m, Sandbag Lunges 100 m and 100 Wall Balls. This plan trains 4 days a week (Mon, Tue, Thu, Sat): strength and sleds, run intervals, compromised running (running on tired legs, the skill that decides most races) and an easy aerobic day. Weeks 1–3 build the base, weeks 4–6 bring race weights and race pace, week 7 is a full race simulation and week 8 is taper and race. Log your times on runs and stations; the app tracks your splits and tells you when you're faster.$tpl$,
  $tpl$[{"name": "Mon · Strength & sleds", "items": [{"name": "Back Squat or Goblet Squat", "sets": "4", "reps": "6–8", "rest": "2–3 min", "note": "Main lift. Strong legs make the sleds and lunges easier.", "ref": "legs", "kind": "main"}, {"name": "Romanian Deadlift", "sets": "3", "reps": "8", "rest": "2 min", "note": "", "ref": "legs", "kind": "main"}, {"name": "Sled Push", "sets": "4", "reps": "25 m", "rest": "90 sec", "note": "Race weight (sled included): men 335 lb (152 kg), women 225 lb (102 kg). No sled? Push a loaded prowler, or a treadmill with the motor off.", "ref": "", "log": "time", "lb": true, "byWeek": [{"from": 1, "to": 3, "sets": "4", "reps": "25 m", "rest": "90 sec", "note": "Moderate weight, short fast steps, arms locked. Race weight (sled included): men 335 lb (152 kg), women 225 lb (102 kg). No sled? Push a loaded prowler, or a treadmill with the motor off."}, {"from": 4, "to": 6, "sets": "5", "reps": "25 m", "rest": "90 sec", "note": "Race weight. Keep the sled moving; stopping costs the most time. Race weight (sled included): men 335 lb (152 kg), women 225 lb (102 kg). No sled? Push a loaded prowler, or a treadmill with the motor off."}, {"from": 7, "to": 7, "sets": "4", "reps": "50 m", "rest": "2 min", "note": "Race weight, race distance. Race weight (sled included): men 335 lb (152 kg), women 225 lb (102 kg). No sled? Push a loaded prowler, or a treadmill with the motor off."}, {"from": 8, "to": 8, "sets": "2", "reps": "25 m", "rest": "2 min", "note": "Race week: light and fast, just to stay sharp."}]}, {"name": "Sled Pull", "sets": "4", "reps": "25 m", "rest": "90 sec", "note": "Race weight (sled included): men 227 lb (103 kg), women 172 lb (78 kg). Hand over hand with a rope, walking backward. No sled? Heavy rope pulls or cable rows.", "ref": "", "log": "time", "lb": true, "byWeek": [{"from": 1, "to": 3, "sets": "4", "reps": "25 m", "rest": "90 sec", "note": "Moderate weight. Sit low, pull with your legs and back, not just arms. Race weight (sled included): men 227 lb (103 kg), women 172 lb (78 kg). Hand over hand with a rope, walking backward. No sled? Heavy rope pulls or cable rows."}, {"from": 4, "to": 6, "sets": "5", "reps": "25 m", "rest": "90 sec", "note": "Race weight. Race weight (sled included): men 227 lb (103 kg), women 172 lb (78 kg). Hand over hand with a rope, walking backward. No sled? Heavy rope pulls or cable rows."}, {"from": 7, "to": 7, "sets": "4", "reps": "50 m", "rest": "2 min", "note": "Race weight, race distance. Race weight (sled included): men 227 lb (103 kg), women 172 lb (78 kg). Hand over hand with a rope, walking backward. No sled? Heavy rope pulls or cable rows."}, {"from": 8, "to": 8, "sets": "2", "reps": "25 m", "rest": "2 min", "note": "Race week: light and fast."}]}, {"name": "Sandbag Walking Lunge", "sets": "3", "reps": "10–12", "rest": "90 sec", "note": "Reps are per leg. Race weight: men 44 lb (20 kg), women 22 lb (10 kg) sandbag on your shoulders. Back knee touches the floor every rep.", "ref": "legs", "kind": "acc"}, {"name": "Farmers Carry", "sets": "4", "reps": "50 m", "rest": "60 sec", "note": "Race weight: men 2 × 53 lb (24 kg), women 2 × 35 lb (16 kg) kettlebells or dumbbells.", "ref": "", "log": "time", "lb": true, "byWeek": [{"from": 1, "to": 3, "sets": "4", "reps": "50 m", "rest": "60 sec", "note": "Tall chest, quick steps. Race weight: men 2 × 53 lb (24 kg), women 2 × 35 lb (16 kg) kettlebells or dumbbells."}, {"from": 4, "to": 6, "sets": "4", "reps": "100 m", "rest": "90 sec", "note": "Race weight, no putting it down. Race weight: men 2 × 53 lb (24 kg), women 2 × 35 lb (16 kg) kettlebells or dumbbells."}, {"from": 7, "to": 7, "sets": "2", "reps": "200 m", "rest": "2 min", "note": "Race weight, race distance. Race weight: men 2 × 53 lb (24 kg), women 2 × 35 lb (16 kg) kettlebells or dumbbells."}, {"from": 8, "to": 8, "sets": "2", "reps": "50 m", "rest": "90 sec", "note": "Race week: easy."}]}]}, {"name": "Tue · Run intervals", "items": [{"name": "Easy jog warm-up", "sets": "1", "reps": "10 min", "rest": "", "note": "Then a few leg swings and 3 quick 20-second strides.", "ref": ""}, {"name": "Run intervals", "sets": "6", "reps": "400 m", "rest": "90 sec", "note": "", "ref": "", "log": "time", "byWeek": [{"from": 1, "to": 3, "sets": "6", "reps": "400 m", "rest": "90 sec", "note": "At about your 5K pace: hard but steady. Log each one and keep them all within a few seconds."}, {"from": 4, "to": 6, "sets": "5", "reps": "1 km", "rest": "2 min", "note": "Your goal race pace or a little faster. Every 1 km the same speed."}, {"from": 7, "to": 7, "sets": "4", "reps": "1 km", "rest": "90 sec", "note": "Race pace. Short rest, like the race."}, {"from": 8, "to": 8, "sets": "3", "reps": "400 m", "rest": "2 min", "note": "Race week: quick and relaxed. Stay sharp, don't get tired."}]}, {"name": "SkiErg", "sets": "4", "reps": "250 m", "rest": "60 sec", "note": "", "ref": "", "log": "time", "byWeek": [{"from": 1, "to": 3, "sets": "4", "reps": "250 m", "rest": "60 sec", "note": "Strong pull with your hips and lats, not just arms. No SkiErg? Use a rower."}, {"from": 4, "to": 6, "sets": "4", "reps": "500 m", "rest": "90 sec", "note": "Race pace. No SkiErg? Use a rower."}, {"from": 7, "to": 7, "sets": "1", "reps": "1000 m", "rest": "", "note": "Race distance at race effort. No SkiErg? Use a rower."}, {"from": 8, "to": 8, "sets": "2", "reps": "250 m", "rest": "90 sec", "note": "Race week: easy and smooth."}]}, {"name": "Cool-down walk", "sets": "1", "reps": "5–10 min", "rest": "", "note": "", "ref": ""}]}, {"name": "Wed · Rest", "items": [{"name": "Rest", "sets": "", "reps": "Easy walk, stretch, foam roll", "rest": "", "note": "", "ref": ""}]}, {"name": "Thu · Compromised running", "items": [{"name": "Run", "sets": "3", "reps": "500 m", "rest": "", "note": "", "ref": "", "log": "time", "byWeek": [{"from": 1, "to": 3, "sets": "3", "reps": "500 m", "rest": "", "note": "Circuit: run, then straight into Wall Balls, Burpee Broad Jumps and Row, then run again. That's one round; rest 2 minutes between rounds. Running on tired legs is the #1 skill in HYROX."}, {"from": 4, "to": 6, "sets": "4", "reps": "1 km", "rest": "", "note": "Circuit: 1 km run, then Wall Balls, Burpee Broad Jumps and Row, then run again. Rest 2 minutes between rounds. Hold your run pace even when your legs are heavy."}, {"from": 7, "to": 7, "sets": "4", "reps": "1 km", "rest": "", "note": "Circuit at race pace. Rest only 90 seconds between rounds."}, {"from": 8, "to": 8, "sets": "2", "reps": "500 m", "rest": "", "note": "Race week: 2 easy rounds, just to rehearse."}]}, {"name": "Wall Balls", "sets": "3", "reps": "20", "rest": "", "note": "Race standard: men 14 lb ball to a 10 ft target, women 9 lb ball to 9 ft. Full squat below parallel every rep.", "ref": "", "lb": true, "byWeek": [{"from": 1, "to": 3, "sets": "3", "reps": "20", "rest": "", "note": "Race standard: men 14 lb ball to a 10 ft target, women 9 lb ball to 9 ft. Full squat below parallel every rep."}, {"from": 4, "to": 6, "sets": "4", "reps": "25", "rest": "", "note": "Try to go unbroken. Race standard: men 14 lb ball to a 10 ft target, women 9 lb ball to 9 ft. Full squat below parallel every rep."}, {"from": 7, "to": 7, "sets": "4", "reps": "25", "rest": "", "note": "Unbroken. Race standard: men 14 lb ball to a 10 ft target, women 9 lb ball to 9 ft. Full squat below parallel every rep."}, {"from": 8, "to": 8, "sets": "2", "reps": "15", "rest": "", "note": "Race standard: men 14 lb ball to a 10 ft target, women 9 lb ball to 9 ft. Full squat below parallel every rep."}]}, {"name": "Burpee Broad Jumps", "sets": "3", "reps": "20 m", "rest": "", "note": "", "ref": "", "log": "time", "byWeek": [{"from": 1, "to": 3, "sets": "3", "reps": "20 m", "rest": "", "note": "Chest to the floor, then jump forward with both feet. Find a steady rhythm you can hold."}, {"from": 4, "to": 6, "sets": "4", "reps": "20 m", "rest": "", "note": "Steady rhythm, no long pauses on the floor."}, {"from": 7, "to": 7, "sets": "4", "reps": "20 m", "rest": "", "note": "Race rhythm."}, {"from": 8, "to": 8, "sets": "2", "reps": "10 m", "rest": "", "note": "Easy."}]}, {"name": "Row", "sets": "3", "reps": "250 m", "rest": "2 min", "note": "", "ref": "", "log": "time", "byWeek": [{"from": 1, "to": 3, "sets": "3", "reps": "250 m", "rest": "2 min", "note": "Legs, then body, then arms. Rest 2 minutes after this, then start the next round."}, {"from": 4, "to": 6, "sets": "4", "reps": "500 m", "rest": "2 min", "note": "Race pace, then rest 2 minutes and start the next round."}, {"from": 7, "to": 7, "sets": "4", "reps": "500 m", "rest": "90 sec", "note": "Race pace, then 90 seconds and go again."}, {"from": 8, "to": 8, "sets": "2", "reps": "250 m", "rest": "2 min", "note": "Easy."}]}]}, {"name": "Fri · Rest", "items": [{"name": "Rest", "sets": "", "reps": "Rest or an easy 20–30 minute walk", "rest": "", "note": "", "ref": ""}]}, {"name": "Sat · Engine & race prep", "items": [{"name": "Zone 2 run", "sets": "1", "reps": "35–45 min", "rest": "", "note": "", "ref": "", "byWeek": [{"from": 1, "to": 3, "sets": "1", "reps": "35–45 min", "rest": "", "note": "Easy: you can talk in full sentences. Your Zone 2 heart rate is in the app. This builds the engine that carries you through 8 km of running."}, {"from": 4, "to": 6, "sets": "1", "reps": "45–60 min", "rest": "", "note": "Easy pace, conversation pace. Add a few minutes each week."}, {"from": 7, "to": 8, "skip": true}]}, {"name": "Burpee Broad Jumps + Wall Balls", "sets": "1", "reps": "10 min", "rest": "", "note": "", "ref": "", "byWeek": [{"from": 1, "to": 3, "sets": "1", "reps": "10 min", "rest": "", "note": "After the run: every minute, 5 Burpee Broad Jumps then 10 Wall Balls. Rest the remainder of the minute."}, {"from": 4, "to": 6, "sets": "1", "reps": "12 min", "rest": "", "note": "After the run: every minute, 6 Burpee Broad Jumps then 12 Wall Balls."}, {"from": 7, "to": 8, "skip": true}]}, {"name": "Sim: 1 km Run", "sets": "8", "reps": "1 km", "rest": "", "note": "Full HYROX simulation. Order: run, SkiErg, run, Sled Push, run, Sled Pull, run, Burpee Broad Jumps, run, Row, run, Farmers Carry, run, Sandbag Lunges, run, Wall Balls. Log each 1 km split here and each station below. Go straight to the next piece: the clock doesn't stop.", "ref": "", "log": "time", "byWeek": [{"from": 1, "to": 6, "skip": true}, {"from": 8, "to": 8, "skip": true}]}, {"name": "Sim: SkiErg", "sets": "1", "reps": "1000 m", "rest": "", "note": "", "ref": "", "log": "time", "byWeek": [{"from": 1, "to": 6, "skip": true}, {"from": 8, "to": 8, "skip": true}]}, {"name": "Sim: Sled Push", "sets": "1", "reps": "50 m", "rest": "", "note": "Race weight (sled included): men 335 lb (152 kg), women 225 lb (102 kg). No sled? Push a loaded prowler, or a treadmill with the motor off.", "ref": "", "log": "time", "lb": true, "byWeek": [{"from": 1, "to": 6, "skip": true}, {"from": 8, "to": 8, "skip": true}]}, {"name": "Sim: Sled Pull", "sets": "1", "reps": "50 m", "rest": "", "note": "Race weight (sled included): men 227 lb (103 kg), women 172 lb (78 kg). Hand over hand with a rope, walking backward. No sled? Heavy rope pulls or cable rows.", "ref": "", "log": "time", "lb": true, "byWeek": [{"from": 1, "to": 6, "skip": true}, {"from": 8, "to": 8, "skip": true}]}, {"name": "Sim: Burpee Broad Jumps", "sets": "1", "reps": "80 m", "rest": "", "note": "", "ref": "", "log": "time", "byWeek": [{"from": 1, "to": 6, "skip": true}, {"from": 8, "to": 8, "skip": true}]}, {"name": "Sim: Row", "sets": "1", "reps": "1000 m", "rest": "", "note": "", "ref": "", "log": "time", "byWeek": [{"from": 1, "to": 6, "skip": true}, {"from": 8, "to": 8, "skip": true}]}, {"name": "Sim: Farmers Carry", "sets": "1", "reps": "200 m", "rest": "", "note": "Race weight: men 2 × 53 lb (24 kg), women 2 × 35 lb (16 kg) kettlebells or dumbbells.", "ref": "", "log": "time", "lb": true, "byWeek": [{"from": 1, "to": 6, "skip": true}, {"from": 8, "to": 8, "skip": true}]}, {"name": "Sim: Sandbag Lunges", "sets": "1", "reps": "100 m", "rest": "", "note": "Race weight: men 44 lb (20 kg), women 22 lb (10 kg) sandbag on your shoulders. Back knee touches the floor every rep.", "ref": "", "log": "time", "lb": true, "byWeek": [{"from": 1, "to": 6, "skip": true}, {"from": 8, "to": 8, "skip": true}]}, {"name": "Sim: Wall Balls", "sets": "1", "reps": "100 reps", "rest": "", "note": "Race standard: men 14 lb ball to a 10 ft target, women 9 lb ball to 9 ft. Full squat below parallel every rep.", "ref": "", "log": "time", "lb": true, "byWeek": [{"from": 1, "to": 6, "skip": true}, {"from": 8, "to": 8, "skip": true}]}, {"name": "Race day", "sets": "1", "reps": "finish time", "rest": "", "note": "Race HYROX! Log your official finish time. No race booked? Do the full simulation again and beat your week 7 time.", "ref": "", "log": "time", "byWeek": [{"from": 1, "to": 7, "skip": true}]}]}, {"name": "Sun · Rest", "items": [{"name": "Rest", "sets": "", "reps": "Full rest. Eat well and sleep 8 hours.", "rest": "", "note": "", "ref": ""}]}]$tpl$::jsonb,
  $tpl${"name": "8-Week HYROX Prep", "weeks": 8, "daysPerWeek": 4, "phases": [{"from": 1, "to": 3, "name": "Base", "note": "Build the engine and learn the stations. Runs at a steady, repeatable pace; sleds and carries at moderate weight. Strength: 2 good reps left in the tank.", "main": {"sets": 4, "reps": "6–8", "rir": "2", "rest": "2–3 min"}, "acc": {"sets": 3, "reps": "10–12", "rir": "2", "rest": "90 sec"}}, {"from": 4, "to": 6, "name": "Build", "note": "Race weights on the sleds and carries, 1 km repeats at race pace, longer compromised-running rounds. Log every split and try to beat last week.", "main": {"sets": 4, "reps": "5–6", "rir": "1–2", "rest": "3 min"}, "acc": {"sets": 3, "reps": "8–10", "rir": "1–2", "rest": "90 sec"}}, {"from": 7, "to": 7, "name": "Race simulation", "note": "Saturday is a full HYROX simulation: 8 × 1 km run with all 8 stations. Log every split; the app adds up your total time. Lighter strength work this week.", "main": {"sets": 3, "reps": "5", "rir": "2", "rest": "3 min"}, "acc": {"sets": 2, "reps": "10", "rir": "2", "rest": "90 sec"}}, {"from": 8, "to": 8, "name": "Taper & race", "note": "Race week: less work, same sharpness. Short, quick sessions, lots of sleep and carbs the 2 days before. Saturday: race, or re-run the simulation and beat week 7.", "main": {"sets": 2, "reps": "5", "rir": "3", "rest": "2 min"}, "acc": {"sets": 2, "reps": "8", "rir": "3", "rest": "90 sec"}, "deload": true}]}$tpl$::jsonb
where not exists (select 1 from public.plan_templates where lower(name) = lower('8-Week HYROX Prep (4-day)'));

-- ---------- progress photos (private bucket) ----------
-- Files are stored as <client id>/<random id>.jpg. Uploads never overwrite,
-- so no update policy is needed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "progress photos read" on storage.objects;
create policy "progress photos read" on storage.objects
  for select to authenticated
  using (bucket_id = 'progress-photos' and (
    (select private.is_trainer())
    or (storage.foldername(name))[1] in (select c::text from private.my_client_ids() as c)
  ));

drop policy if exists "progress photos upload" on storage.objects;
create policy "progress photos upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'progress-photos' and (
    (select private.is_trainer())
    or (storage.foldername(name))[1] in (select c::text from private.my_client_ids() as c)
  ));

drop policy if exists "progress photos delete" on storage.objects;
create policy "progress photos delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'progress-photos' and (
    (select private.is_trainer())
    or (storage.foldername(name))[1] in (select c::text from private.my_client_ids_any() as c)
  ));

-- ---------- delete my account (required by Apple for apps with sign-in) ----------
-- A client can permanently delete their own login and everything in it: client
-- record, check-ins, plan, workouts, Health and water data (all cascade). The
-- tracker removes their photos first. Coach accounts can't delete themselves here.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.trainers where user_id = uid) then
    raise exception 'Coach accounts can''t be deleted from the app. Email info@renovocoach.com.';
  end if;
  delete from public.clients where user_id = uid;
  delete from auth.users where id = uid;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- make yourself the trainer ----------
-- Sign in to the tracker once with your email, then run this on its own
-- with your email address in place of YOUR_EMAIL:
--
--   insert into public.trainers (user_id)
--   select id from auth.users where lower(email) = lower('YOUR_EMAIL')
--   on conflict do nothing;
