-- oxy:deploy-phase=pre
--
-- Two roommate-preference columns with no earlier source, added new.
--
-- `EDITABLE_ROOMMATE_PREFERENCE_FIELDS` accepts `location` and `interests` and
-- `RoommateFilters` sends both, but no column held either, so every update
-- discarded them. Two things depend on these values: the discover `location`
-- filter, and `calculateMatchPercentage`'s interests branch, worth 20 of its
-- 100 points.
--
-- ADDITIVE and therefore `pre`: nothing drops, nothing narrows, and the
-- previous image neither reads nor writes either column. `profiles` holds five
-- production rows, so the ALTER is instantaneous. Both nullable, like every
-- other column on this table — NULL is how "never answered" is represented once
-- the `personalProfile` block is flattened away (see `db/schema/profiles.ts`).
ALTER TABLE "profiles" ADD COLUMN "settings_roommate_preferences_location" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "settings_roommate_preferences_interests" text[];
