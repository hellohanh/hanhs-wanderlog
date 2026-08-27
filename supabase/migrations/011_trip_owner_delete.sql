-- Migration 011: owner-only delete policy for trips
-- Session 18 — non-destructive (adds a policy, touches no existing
-- rows). Per L10 (SKILL.md): schema.sql itself must never be re-run
-- against a database with real data — migrations like this one are
-- how schema changes get applied going forward instead.
--
-- Purpose: trips had select/update/insert RLS policies but no delete
-- policy at all, so deleting a trip was silently blocked by RLS
-- regardless of the delete GRANT already on the table. Per the user:
-- deletion is owner-only, unlike every other permission in this app
-- (E5 — invited members get full edit rights on everything else) —
-- deleting a trip cascades pins, itinerary_days, itinerary_stops,
-- travel_legs, and trip_members all at once with no undo, which is a
-- meaningfully different risk than editing a pin or a day.
--
-- Status: provided to the user in chat during this session — not yet
-- confirmed run against the live Supabase project as of this file's
-- creation. Confirm/update this note once applied.

create policy "trip owner can delete trips"
  on trips for delete
  using (owner_id = auth.uid());
