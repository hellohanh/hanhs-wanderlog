-- Migration 001: allow 'transport' as a pin category
-- Session 5/6 — non-destructive, does NOT touch existing rows.
-- Per L10 (SKILL.md): schema.sql itself must never be re-run against a
-- database with real data — migrations like this one are how schema
-- changes get applied going forward instead.
--
-- Status: provided to the user in chat during Session 6 — not yet
-- confirmed run against the live Supabase project as of this file's
-- creation. Confirm/update this note once applied.

alter table pins drop constraint if exists pins_category_check;
alter table pins add constraint pins_category_check check (
  category in ('attraction', 'dining', 'accommodation', 'airport', 'transport', 'shopping', 'cafe', 'bakery')
);
