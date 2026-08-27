-- Migration 005: itinerary_days and itinerary_stops tables
-- Session 13 — additive only, creates two new tables that didn't
-- exist in the live database before (only ever drafted as unused TS
-- types in src/types/index.ts). Does not touch trips/pins/trip_members.
--
-- Purpose: backs the new Itinerary tab — day tabs (auto-generated from
-- the trip's dates when set, or added manually), and per-day ordered
-- stops (each referencing an existing pin) with optional start/end
-- times.
--
-- Per L20 (SKILL.md): grant + policy for every CRUD operation
-- (select/insert/update/delete) is added together here, from the
-- start, rather than bolted on piecemeal later the way pins' delete
-- and update permissions had to be (migrations 003, 004) — the
-- itinerary UI needs full drag/reorder/edit/remove from day one.
--
-- Status: provided to the user in chat during this session — not yet
-- confirmed run against the live Supabase project as of this file's
-- creation. Confirm/update this note once applied.

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

alter table itinerary_days enable row level security;
alter table itinerary_stops enable row level security;

grant select, insert, update, delete on itinerary_days to authenticated;
grant select, insert, update, delete on itinerary_stops to authenticated;

-- Per E5: every invited trip member gets full edit rights, no
-- owner/contributor tiers — same "is this user a trip owner or
-- member" check used everywhere else (trips, pins).

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

-- itinerary_stops policies check trip membership by joining through
-- itinerary_days (stops have no trip_id of their own).

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
