-- Hanh's Wanderlog — initial Supabase schema
-- Covers: trips, pins (attractions + restaurants), trip membership,
-- and shareable invite links (E17 in SKILL.md).
-- Itinerary/budget/packing tables are not included yet — those tabs
-- are still placeholders in the UI (see README.md What's Built).
--
-- Safe to re-run: drops existing objects first so a partial or repeat
-- run doesn't fail with "relation already exists".

drop function if exists join_trip_via_invite(uuid);
drop table if exists trip_members cascade;
drop table if exists pins cascade;
drop table if exists trips cascade;

create table trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  destination text not null,
  start_date date,
  end_date date,
  owner_id uuid references auth.users(id),
  invite_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz default now()
);

create table pins (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade,
  name text not null,
  category text not null default 'attraction',
  lat double precision not null,
  lng double precision not null,
  notes text,
  added_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table trip_members (
  trip_id uuid references trips(id) on delete cascade,
  user_id uuid references auth.users(id),
  primary key (trip_id, user_id)
);

alter table trips enable row level security;
alter table pins enable row level security;
alter table trip_members enable row level security;

-- Row Level Security policies (below) control WHICH rows a role can
-- see or touch, but Postgres separately requires base GRANT
-- privileges on the table itself before RLS is even evaluated.
-- Creating tables via the SQL Editor does not set these
-- automatically the way the Supabase dashboard's table UI does.
grant usage on schema public to authenticated;
grant select, insert, update, delete on trips to authenticated;
grant select, insert on pins to authenticated;
grant select on trip_members to authenticated;

-- Per E5 (SKILL.md): every invited member gets full edit rights,
-- no owner/contributor permission tiers.

create policy "trip members can view trips"
  on trips for select
  using (
    owner_id = auth.uid()
    or exists (select 1 from trip_members where trip_id = trips.id and user_id = auth.uid())
  );

create policy "trip members can edit trips"
  on trips for update
  using (
    owner_id = auth.uid()
    or exists (select 1 from trip_members where trip_id = trips.id and user_id = auth.uid())
  );

create policy "authenticated users can create trips"
  on trips for insert
  with check (owner_id = auth.uid());

create policy "trip members can view pins"
  on pins for select
  using (
    exists (
      select 1 from trips
      where trips.id = pins.trip_id
      and (
        trips.owner_id = auth.uid()
        or exists (select 1 from trip_members where trip_id = trips.id and user_id = auth.uid())
      )
    )
  );

create policy "trip members can add pins"
  on pins for insert
  with check (
    exists (
      select 1 from trips
      where trips.id = pins.trip_id
      and (
        trips.owner_id = auth.uid()
        or exists (select 1 from trip_members where trip_id = trips.id and user_id = auth.uid())
      )
    )
  );

-- Invite-link join flow (E17). We deliberately do NOT open a broad
-- SELECT policy on trips for "anyone with a token" — that would let
-- any authenticated user enumerate every trip's basic info. Instead,
-- both the token lookup and the membership insert happen inside a
-- single SECURITY DEFINER function, so the only thing a caller can do
-- with a token is join the one trip it belongs to.

create or replace function join_trip_via_invite(_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _trip_id uuid;
begin
  select id into _trip_id from trips where invite_token = _token;

  if _trip_id is null then
    raise exception 'invalid invite token';
  end if;

  insert into trip_members (trip_id, user_id)
  values (_trip_id, auth.uid())
  on conflict (trip_id, user_id) do nothing;

  return _trip_id;
end;
$$;

grant execute on function join_trip_via_invite(uuid) to authenticated;
