-- Migration 003: allow trip members to delete pins
-- Session 12 — non-destructive to existing rows; adds a capability
-- (DELETE) that did not exist before. Per L10 (SKILL.md): schema.sql
-- itself must never be re-run against a database with real data —
-- migrations like this one are how schema changes get applied going
-- forward instead.
--
-- Purpose: supports the new delete-pin button in the sidebar. Mirrors
-- E5 (every invited trip member gets full edit rights, no
-- owner/contributor tiers) — same "is this user a trip owner or
-- member" check already used by the existing select/insert policies
-- on pins.
--
-- Status: provided to the user in chat during this session — not yet
-- confirmed run against the live Supabase project as of this file's
-- creation. Confirm/update this note once applied.

grant delete on pins to authenticated;

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
