-- Migration 007: travel_legs table
-- Session 15 — additive only, creates a new table for the Itinerary
-- tab's travel-day cards (flight/train/bus/personal). Does not touch
-- any existing table.
--
-- Purpose: a per-day "travel" section, separate from the regular pin
-- stops list, for the leg(s) that actually move you between places
-- that day — a flight, train, bus, or personal transport (rental car,
-- ride, etc). Modeled after a simplified version of a flight-tracker
-- card (see chat) but with NO live status/tracking, since real-time
-- flight tracking is explicitly out of scope (E9) — from_time/to_time
-- are whatever the user types in, not live data.
--
-- Per L20 (SKILL.md): grant + policy for every CRUD operation
-- (select/insert/update/delete) is added together here, from the
-- start, matching the itinerary_days/itinerary_stops pattern from
-- migration 005 rather than pins' piecemeal history (migrations
-- 003/004 bolted on delete/update separately).
--
-- Status: provided to the user in chat during this session — not yet
-- confirmed run against the live Supabase project as of this file's
-- creation. Confirm/update this note once applied.

create table travel_legs (
  id uuid primary key default gen_random_uuid(),
  itinerary_day_id uuid references itinerary_days(id) on delete cascade,
  mode text not null check (mode in ('flight', 'train', 'bus', 'personal')),
  carrier text,
  reference text,
  from_location text not null,
  from_time time,
  to_location text not null,
  to_time time,
  order_index int not null default 0,
  created_at timestamptz default now()
);

alter table travel_legs enable row level security;

grant select, insert, update, delete on travel_legs to authenticated;

-- Same "is this user a trip owner or member" check as itinerary_stops,
-- joined through itinerary_days since travel_legs has no trip_id of
-- its own either.

create policy "trip members can view travel legs"
  on travel_legs for select
  using (
    exists (
      select 1 from itinerary_days
      join trips on trips.id = itinerary_days.trip_id
      where itinerary_days.id = travel_legs.itinerary_day_id
      and (
        trips.owner_id = auth.uid()
        or exists (select 1 from trip_members where trip_id = trips.id and user_id = auth.uid())
      )
    )
  );

create policy "trip members can add travel legs"
  on travel_legs for insert
  with check (
    exists (
      select 1 from itinerary_days
      join trips on trips.id = itinerary_days.trip_id
      where itinerary_days.id = travel_legs.itinerary_day_id
      and (
        trips.owner_id = auth.uid()
        or exists (select 1 from trip_members where trip_id = trips.id and user_id = auth.uid())
      )
    )
  );

create policy "trip members can update travel legs"
  on travel_legs for update
  using (
    exists (
      select 1 from itinerary_days
      join trips on trips.id = itinerary_days.trip_id
      where itinerary_days.id = travel_legs.itinerary_day_id
      and (
        trips.owner_id = auth.uid()
        or exists (select 1 from trip_members where trip_id = trips.id and user_id = auth.uid())
      )
    )
  );

create policy "trip members can delete travel legs"
  on travel_legs for delete
  using (
    exists (
      select 1 from itinerary_days
      join trips on trips.id = itinerary_days.trip_id
      where itinerary_days.id = travel_legs.itinerary_day_id
      and (
        trips.owner_id = auth.uid()
        or exists (select 1 from trip_members where trip_id = trips.id and user_id = auth.uid())
      )
    )
  );
