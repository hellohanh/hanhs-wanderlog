-- Migration 002: add place_id to pins
-- Session 12 — non-destructive, does NOT touch existing rows.
-- Per L10 (SKILL.md): schema.sql itself must never be re-run against a
-- database with real data — migrations like this one are how schema
-- changes get applied going forward instead.
--
-- Purpose: links a pin to its Google Place ID so the sidebar's
-- name/address/phone lookup (added this session) can call Places
-- Details (New) directly for pins added via search, instead of
-- guessing by name + location every time. Nullable — pins added by a
-- plain map click aren't tied to a real Google place and will keep
-- place_id = null, which the app already handles with a best-effort
-- name-based fallback lookup.
--
-- Status: provided to the user in chat during this session — not yet
-- confirmed run against the live Supabase project as of this file's
-- creation. Confirm/update this note once applied.

alter table pins add column if not exists place_id text;
