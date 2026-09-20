-- oxy:deploy-phase=pre
--
-- "Ground floor" and "nobody said" stop being the same value (#518 §6, #519 §6.1).
--
-- `floor` was `NOT NULL DEFAULT 0`, so every listing whose floor nobody filled
-- in was recorded as being on the ground floor. A filter for a ground-floor
-- flat would have matched almost the whole catalogue — not a filter with a
-- rounding error in it, a filter that answers a different question.
--
-- PRE, and the ordering inside it matters: the column has to accept NULL
-- before the backfill can write one.
--
-- WHAT THE OLD IMAGE SEES while it is still serving: `floor` can now be null
-- where its types say `number`. It never computes with the value — it copies it
-- onto the wire at `exact` precision and nowhere else — so the visible effect is
-- `floor: null` instead of `floor: 0` on an owner's own listing, for the length
-- of one rollout. That is the honest value, arriving early.
--
-- THE BACKFILL IS LOSSY, AND DELIBERATELY SO. At rest, a deliberate 0 and a
-- defaulted 0 are the same bytes; nothing distinguishes them, so nothing can
-- preserve the first while clearing the second. Clearing both is the reading
-- that cannot assert something false: "we do not know" is true of every one of
-- these rows today, and "this flat is on the ground floor" is true of an
-- unknown few. The few are not lost for long — external listings are
-- re-ingested continuously, and the provider layer has always parsed
-- `ground_floor` as a real 0.

ALTER TABLE "properties" ALTER COLUMN "floor" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "properties" ALTER COLUMN "floor" DROP NOT NULL;--> statement-breakpoint
UPDATE "properties" SET "floor" = NULL WHERE "floor" = 0;
