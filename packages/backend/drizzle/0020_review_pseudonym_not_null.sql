-- oxy:deploy-phase=post
--
-- The CONTRACT half of the pair `0019_review_author_publication` opened. See
-- that file for why `reviews.author_pseudonym` could not land `NOT NULL` in one
-- step.
--
-- POST, and the ordering is what makes it safe: production runs `--phase=post`
-- in the WORKER lane, after the worker's rollout, which is the last thing to
-- roll — so by the time this executes no image without `author_pseudonym` in its
-- insert is serving, and nothing can write a NULL after the backfill below and
-- before the constraint.
--
-- The backfill is repeated rather than assumed done: PRE covered the rows that
-- existed when it ran, and the rollout window is exactly the interval in which
-- an old image could have written more. Running it twice is safe by
-- construction — `IS NULL` is the predicate, so a row PRE already filled is not
-- touched, and the grouping still gives one value per (author, building).
--
-- `SET NOT NULL` scans the table under an ACCESS EXCLUSIVE lock. `reviews` was
-- empty at the 2026-08-06 census and is small by any reading of it, so the scan
-- is not the concern; if it ever stops being small, the `NOT VALID` CHECK +
-- `VALIDATE` + `SET NOT NULL` dance is the replacement, and it is a different
-- migration rather than a tweak to this one.

UPDATE "reviews" AS r
SET "author_pseudonym" = g.pseudonym
FROM (
  SELECT "oxy_user_id", "building_level_id",
         md5(random()::text || clock_timestamp()::text) AS pseudonym
  FROM "reviews"
  GROUP BY 1, 2
) AS g
WHERE r."oxy_user_id" = g."oxy_user_id"
  AND r."building_level_id" = g."building_level_id"
  AND r."author_pseudonym" IS NULL;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "author_pseudonym" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_pseudonym_check" CHECK (length("reviews"."author_pseudonym") > 0);
