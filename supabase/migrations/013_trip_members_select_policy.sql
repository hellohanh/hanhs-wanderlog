-- Migration 013: trip_members was missing its own RLS policy entirely.
-- Session 23 (continued) — discovered live, the same night as the
-- required-email revert, while debugging why a genuinely joined member
-- (confirmed present in trip_members) still couldn't read the trip.
--
-- Root cause: trip_members has had RLS enabled since it was created
-- (schema.sql: `alter table trip_members enable row level security;`)
-- but NO policy was ever defined for it — not in schema.sql, not in
-- any numbered migration. With RLS on and zero policies, Postgres
-- denies ALL access by default, including from WITHIN another table's
-- policy. Every other policy in this schema that checks membership —
-- on trips, pins, itinerary_days, itinerary_stops, travel_legs — does
-- it via `exists (select 1 from trip_members where trip_id = ... and
-- user_id = auth.uid())`. That subquery itself is a read against
-- trip_members, so it was ALSO silently blocked by trip_members' own
-- RLS the entire time, for every single one of those policies. In
-- other words: sharing a trip has probably never actually granted a
-- non-owner real read access to anything, since the feature was first
-- built (E17) — the RPC that ADDS someone to trip_members works fine
-- (SECURITY DEFINER bypasses RLS entirely), which is exactly why every
-- symptom tonight looked like "the join succeeds but nothing after it
-- works," across many different accounts and many different pages.
--
-- Fix: give trip_members a SELECT policy scoped to the caller's own
-- row. This is deliberately narrow — it does NOT let someone see who
-- ELSE is on a trip, only confirm their own membership — since that's
-- the only thing every other policy's EXISTS check actually needs.
--
-- No grant change needed: schema.sql already has
-- `grant select on trip_members to authenticated;` — the grant existed,
-- only the policy was missing.

create policy "users can view own membership"
  on trip_members for select
  using (user_id = auth.uid());
