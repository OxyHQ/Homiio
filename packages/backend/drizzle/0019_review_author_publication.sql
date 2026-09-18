-- oxy:deploy-phase=pre
--
-- ADR 0003 §5.2 — a review's author is published in one of three forms, chosen
-- by the author: the Oxy handle, a pseudonym stable per author PER BUILDING, or
-- nothing at all. `reviews.oxy_user_id` stays `NOT NULL` and untouched: the ADR
-- is explicit that the LINK must exist for correction, appeal and abuse
-- handling. These two columns decide only what a READER is told.
--
-- The default is `pseudonymous`, not §5.2's own `verified_anonymous_resident`.
-- That form's published text is *"Verified resident"*, and §6.1/F7 record that
-- `reviews.verified` is written by nothing — so defaulting to it would ship
-- exactly the lie §6.1 names, a claim nobody checked rendered as a checkmark.
-- `pseudonymous` discloses no more about the author and asserts nothing Homiio
-- has not done. Revisit with #364, which builds verification.
--
-- ## This is the EXPAND half, and `author_pseudonym` is nullable ON PURPOSE
--
-- The column has no DEFAULT, deliberately — only the application can keep a
-- pseudonym stable per author per building, so a writer that forgets it must
-- fail rather than mint a second handle and tell a reader a new person appeared
-- (the same reasoning `moderation_outbox.id` carries for having no default).
-- But an outgoing API image is still serving `POST /api/reviews` while this
-- runs, and it names its insert columns explicitly, so a `NOT NULL` with no
-- default would make every review submitted during the rollout window fail.
--
-- So: PRE adds it nullable and backfills what exists, and
-- `0020_review_pseudonym_not_null` (POST, after the worker rolls last and no old
-- image is serving) backfills whatever the old image wrote in between and
-- tightens the column. That is the pair the `--phase` mechanism exists for, and
-- this is its first use in this repository.
--
-- The backfill groups by (author, building) and gives each group ONE random
-- value, which is what "stable per author per building" means for rows written
-- before the column existed. It is random rather than a digest of the two ids:
-- a digest is recomputable by anybody who can guess the author, and an owner
-- holding a lease knows exactly one candidate.

ALTER TABLE "reviews" ADD COLUMN "author_identity" text DEFAULT 'pseudonymous' NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "author_pseudonym" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_identity_check" CHECK ("reviews"."author_identity" in ('identified', 'pseudonymous', 'verified_anonymous_resident'));--> statement-breakpoint
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
  AND r."author_pseudonym" IS NULL;
