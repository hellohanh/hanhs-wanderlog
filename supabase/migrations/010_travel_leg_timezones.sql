-- Migration 010: add from_timezone/to_timezone to travel_legs
-- Session 16 — non-destructive, does NOT touch existing rows.
-- Per L10 (SKILL.md): schema.sql itself must never be re-run against a
-- database with real data — migrations like this one are how schema
-- changes get applied going forward instead.
--
-- Purpose: migration 009's date fields fixed same-day-vs-next-day
-- duration, but a naive date+time diff is still wrong whenever
-- departure and arrival are in different timezones (e.g. Austin CST
-- to Los Angeles PST) — the "AA6186, 06:00 -> 07:46" example that
-- prompted this: the two-hour Central->Pacific shift was silently
-- missing from the 1h46m shown, when the real flight is 3h46m.
-- Nullable IANA timezone names (e.g. "America/Chicago") — when either
-- side is unset the app falls back to the old naive same-frame diff,
-- so existing rows keep working with no backfill needed. No RLS/grant
-- change needed: existing select/insert/update policies already cover
-- these columns.
--
-- Status: provided to the user in chat during this session — not yet
-- confirmed run against the live Supabase project as of this file's
-- creation. Confirm/update this note once applied.

alter table travel_legs add column if not exists from_timezone text;
alter table travel_legs add column if not exists to_timezone text;
