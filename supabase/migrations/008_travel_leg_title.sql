-- Migration 008: add title to travel_legs
-- Session 16 — non-destructive, does NOT touch existing rows.
-- Per L10 (SKILL.md): schema.sql itself must never be re-run against a
-- database with real data — migrations like this one are how schema
-- changes get applied going forward instead.
--
-- Purpose: a dedicated header/title field for a travel card (e.g.
-- "San Francisco to New York"), independent of from_location/
-- to_location — those can stay as short codes (SFO/JFK) for the
-- times row while the title reads however the user wants. Nullable —
-- the app falls back to "{from_location} to {to_location}" when this
-- is empty, so existing rows keep working with no backfill needed.
-- No RLS/grant change needed: the existing select/insert/update
-- policies on travel_legs already cover this column.
--
-- Status: provided to the user in chat during this session — not yet
-- confirmed run against the live Supabase project as of this file's
-- creation. Confirm/update this note once applied.

alter table travel_legs add column if not exists title text;
