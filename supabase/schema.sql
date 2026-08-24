-- Hanh's Wanderlog — initial Supabase schema
-- Covers: trips, pins (attractions + restaurants), trip membership,
-- and shareable invite links (E17 in SKILL.md).
-- Itinerary/budget/packing tables are not included yet — those tabs
-- are still placeholders in the UI (see README.md What's Built).

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
