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

create or replace function private.my_client_ids() returns setof uuid
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

-- Only signed-in users may run the two lookup helpers (policies need them).
-- Nobody calls the trigger functions directly.
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_trainer() to authenticated;
grant execute on function private.my_client_ids() to authenticated;

-- ---------- Data API access ----------
-- New Supabase projects don't expose new tables automatically, so grant
-- signed-in users access explicitly. Row level security below decides which rows.
revoke all on public.trainers, public.clients, public.checkins, public.client_plans, public.plan_templates, public.workout_logs, public.health_daily from anon;
grant select on public.trainers to authenticated;
grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.checkins to authenticated;
grant select, insert, update, delete on public.client_plans to authenticated;
grant select, insert, update, delete on public.plan_templates to authenticated;
grant select, insert, update, delete on public.workout_logs to authenticated;
grant select, insert, update, delete on public.health_daily to authenticated;

-- ---------- row level security ----------
alter table public.trainers enable row level security;
alter table public.clients  enable row level security;
alter table public.checkins enable row level security;
alter table public.client_plans enable row level security;
alter table public.plan_templates enable row level security;
alter table public.workout_logs enable row level security;
alter table public.health_daily enable row level security;

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
    or (storage.foldername(name))[1] in (select c::text from private.my_client_ids() as c)
  ));

-- ---------- make yourself the trainer ----------
-- Sign in to the tracker once with your email, then run this on its own
-- with your email address in place of YOUR_EMAIL:
--
--   insert into public.trainers (user_id)
--   select id from auth.users where lower(email) = lower('YOUR_EMAIL')
--   on conflict do nothing;
