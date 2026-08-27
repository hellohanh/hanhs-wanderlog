-- Migration 009: add from_date/to_date to travel_legs
-- Session 16 — non-destructive, does NOT touch existing rows.
-- Per L10 (SKILL.md): schema.sql itself must never be re-run against a
-- database with real data — migrations like this one are how schema
-- changes get applied going forward instead.
--
-- Purpose: correct duration for international/overnight travel. A
-- flight's from_time/to_time alone can't distinguish "arrives same
-- day" from "arrives the next calendar day" (or crosses more days,
-- e.g. a long-haul flight over the date line) — that previously made
-- the duration calculation quietly wrong for exactly the trips this
-- app is most likely to be used for. Nullable — existing rows (or any
-- row where the user only fills in one/neither) fall back to a
-- same-day comparison in the app, matching the old behavior.
-- No RLS/grant change needed: the existing select/insert/update
-- policies on travel_legs already cover these columns.
--
-- Status: provided to the user in chat during this session — not yet
-- confirmed run against the live Supabase project as of this file's
-- creation. Confirm/update this note once applied.

alter table travel_legs add column if not exists from_date date;
alter table travel_legs add column if not exists to_date date;
