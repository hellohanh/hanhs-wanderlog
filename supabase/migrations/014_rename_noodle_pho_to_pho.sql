-- Migration 014: rename the old 'noodle_pho' dining icon variant to
-- 'pho', matching the new Vietnamese-focused dining category list
-- (Session 28/29). Non-destructive — only updates existing rows,
-- doesn't touch the schema.
--
-- Without this, any pin created earlier with icon = 'noodle_pho'
-- would keep showing correctly on the MAP (pinIconSvg falls back to
-- the plain dining icon for an unrecognized key) but would silently
-- drop out of the pinned list's sidebar grouping, since that groups
-- strictly by the CURRENT set of variants in ICON_VARIANTS.dining,
-- which no longer includes 'noodle_pho'.

update pins set icon = 'pho' where icon = 'noodle_pho';
