-- Hanh's Wanderlog — initial Supabase schema
-- Covers: trips, pins (attractions + restaurants), trip membership,
-- and shareable invite links (E17 in SKILL.md).
-- Itinerary/budget/packing tables are not included yet — those tabs
-- are still placeholders in the UI (see README.md What's Built).
--
-- WARNING — DO NOT RE-RUN THIS FULL FILE ONCE REAL DATA EXISTS.
-- The drop statements below make this script error-free to re-run, but
-- they DELETE ALL ROWS in trips/pins/trip_members every time — that is
-- NOT the same as being safe. This file is kept as the canonical
-- reference for the schema's current shape, not as a repeatable script.
-- Any future change to an existing live database must be a small,
-- targeted, non-destructive migration (alter table ... add/drop
-- constraint, add column, etc.) instead.
--
-- This has already wiped real trip data twice (Session 6, Session 12)
-- from someone reasonably assuming a file called "schema.sql" was
-- meant to be run in Supabase's SQL Editor — a comment alone isn't a
-- strong enough guard against that. The block below makes the file
-- refuse to run at all until this line is deliberately deleted. If
-- you are ever asked to actually run this file (schema is being set
-- up completely fresh, on a brand new empty project), delete the
-- "do $$ ... $$;" block immediately below this comment first.

do $$
begin
  raise exception 'schema.sql is reference-only and will DELETE ALL DATA if run — see the warning above. Remove this block only if you are certain you mean to wipe and recreate trips/pins/trip_members from scratch.';
end $$;

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
  category text not null default 'attraction' check (
    category in ('attraction', 'dining', 'accommodation', 'airport', 'transport', 'shopping', 'cafe', 'bakery')
  ),
  lat double precision not null,
  lng double precision not null,
  notes text,
  place_id text,
  added_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table trip_members (
  trip_id uuid references trips(id) on delete cascade,
  user_id uuid references auth.users(id),
  primary key (trip_id, user_id)
);

-- Added in migration 005 (Session 13) — backs the Itinerary tab.
create table itinerary_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade,
  day_number int not null,
  date date,
  created_at timestamptz default now(),
  unique (trip_id, day_number)
);

create table itinerary_stops (
  id uuid primary key default gen_random_uuid(),
  itinerary_day_id uuid references itinerary_days(id) on delete cascade,
  pin_id uuid references pins(id) on delete cascade,
  order_index int not null default 0,
  start_time time,
  end_time time,
  created_at timestamptz default now()
);

alter table trips enable row level security;
alter table pins enable row level security;
alter table trip_members enable row level security;
alter table itinerary_days enable row level security;
alter table itinerary_stops enable row level security;

-- Row Level Security policies (below) control WHICH rows a role can
-- see or touch, but Postgres separately requires base GRANT
-- privileges on the table itself before RLS is even evaluated.
-- Creating tables via the SQL Editor does not set these
-- automatically the way the Supabase dashboard's table UI does.
grant usage on schema public to authenticated;
grant select, insert, update, delete on trips to authenticated;
grant select, insert, delete, update on pins to authenticated;
grant select on trip_members to authenticated;
grant select, insert, update, delete on itinerary_days to authenticated;
grant select, insert, update, delete on itinerary_stops to authenticated;

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

create policy "trip members can delete pins"
  on pins for delete
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

create policy "trip members can update pins"
  on pins for update
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

-- Itinerary tab (added migration 005, Session 13). itinerary_stops has
-- no trip_id of its own, so its policies join through itinerary_days.

create policy "trip members can view itinerary days"
  on itinerary_days for select
  using (
    exists (
      select 1 from trips
      where trips.id = itinerary_days.trip_id
      and (
        trips.owner_id = auth.uid()
        or exists (select 1 from trip_members where trip_id = trips.id and user_id = auth.uid())
      )
    )
  );

create policy "trip members can add itinerary days"
  on itinerary_days for insert
  with check (
    exists (
      select 1 from trips
      where trips.id = itinerary_days.trip_id
      and (
        trips.owner_id = auth.uid()
        or exists (select 1 from trip_members where trip_id = trips.id and user_id = auth.uid())
      )
    )
  );

create policy "trip members can update itinerary days"
  on itinerary_days for update
  using (
    exists (
      select 1 from trips
      where trips.id = itinerary_days.trip_id
      and (
        trips.owner_id = auth.uid()
        or exists (select 1 from trip_members where trip_id = trips.id and user_id = auth.uid())
      )
    )
  );

create policy "trip members can delete itinerary days"
  on itinerary_days for delete
  using (
    exists (
      select 1 from trips
      where trips.id = itinerary_days.trip_id
      and (
        trips.owner_id = auth.uid()
        or exists (select 1 from trip_members where trip_id = trips.id and user_id = auth.uid())
      )
    )
  );

create policy "trip members can view itinerary stops"
  on itinerary_stops for select
  using (
    exists (
      select 1 from itinerary_days
      join trips on trips.id = itinerary_days.trip_id
      where itinerary_days.id = itinerary_stops.itinerary_day_id
      and (
        trips.owner_id = auth.uid()
        or exists (select 1 from trip_members where trip_id = trips.id and user_id = auth.uid())
      )
    )
  );

create policy "trip members can add itinerary stops"
  on itinerary_stops for insert
  with check (
    exists (
      select 1 from itinerary_days
      join trips on trips.id = itinerary_days.trip_id
      where itinerary_days.id = itinerary_stops.itinerary_day_id
      and (
        trips.owner_id = auth.uid()
        or exists (select 1 from trip_members where trip_id = trips.id and user_id = auth.uid())
      )
    )
  );

create policy "trip members can update itinerary stops"
  on itinerary_stops for update
  using (
    exists (
      select 1 from itinerary_days
      join trips on trips.id = itinerary_days.trip_id
      where itinerary_days.id = itinerary_stops.itinerary_day_id
      and (
        trips.owner_id = auth.uid()
        or exists (select 1 from trip_members where trip_id = trips.id and user_id = auth.uid())
      )
    )
  );

create policy "trip members can delete itinerary stops"
  on itinerary_stops for delete
  using (
    exists (
      select 1 from itinerary_days
      join trips on trips.id = itinerary_days.trip_id
      where itinerary_days.id = itinerary_stops.itinerary_day_id
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
