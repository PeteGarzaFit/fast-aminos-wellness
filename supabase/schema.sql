-- FAST AMINOS WELLNESS · Progress Tracker database setup
-- Paste this whole file into Supabase: SQL Editor → New query → Run.
-- It is safe to run again; it updates what already exists.
--
-- Who can see what:
--   * Trainers (rows in public.trainers) see and edit every client.
--   * A client sees only their own record, check-ins and photos, matched by the
--     email the trainer entered for them.
--   * Only trainers can record Omron readings (gym-day calibration).
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
    if not private.is_trainer() then new.omron_bf := null; end if;
  else
    new.entered_by := old.entered_by;
    new.client_id  := old.client_id;
    new.created_at := old.created_at;
    if not private.is_trainer() then new.omron_bf := old.omron_bf; end if;
  end if;
  return new;
end $$;
drop trigger if exists checkins_guard on public.checkins;
create trigger checkins_guard before insert or update on public.checkins
  for each row execute function private.checkins_guard();

-- Only signed-in users may run the two lookup helpers (policies need them).
-- Nobody calls the trigger functions directly.
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_trainer() to authenticated;
grant execute on function private.my_client_ids() to authenticated;

-- ---------- Data API access ----------
-- New Supabase projects don't expose new tables automatically, so grant
-- signed-in users access explicitly. Row level security below decides which rows.
revoke all on public.trainers, public.clients, public.checkins from anon;
grant select on public.trainers to authenticated;
grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.checkins to authenticated;

-- ---------- row level security ----------
alter table public.trainers enable row level security;
alter table public.clients  enable row level security;
alter table public.checkins enable row level security;

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
