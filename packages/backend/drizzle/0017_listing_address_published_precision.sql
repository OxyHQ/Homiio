-- oxy:deploy-phase=pre
--
-- A listing's address publication ceiling (ADR 0003 §3.2 `published_precision`):
-- `exact` | `building` | `street`. The create/edit wizard's "floor: private"
-- toggle was never sent to the API, and every listing endpoint published
-- `floor`, `address.floor`, `address.unit` and `address.subunit` to anybody.
--
-- PRE, because it is purely ADDITIVE and the outgoing image tolerates it:
--
--  - The API lane applies this before `update-service`, so the incoming API
--    image never runs against a table without the column it selects.
--  - The outgoing API image and the worker (which rolls LAST) name the listing
--    columns explicitly and never this one, so their SELECTs are unchanged and
--    their INSERTs — ingested external listings, for the whole rollout — take
--    the DEFAULT, which is a value the CHECK accepts.
--  - `ADD COLUMN … DEFAULT <constant> NOT NULL` is a catalogue-only change on
--    Postgres 11+ (no table rewrite). The CHECK does scan the table once under
--    its lock, but every row holds the constant it just received.
--
-- The DEFAULT is `building` for existing rows as well as new ones, and that is
-- the decision rather than a convenience: no stored listing carries evidence its
-- owner chose to publish the floor or the unit, so every one of them stops
-- publishing it. An owner who wants it public says so from the edit screen.

ALTER TABLE "properties" ADD COLUMN "address_published_precision" text DEFAULT 'building' NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_address_published_precision_check" CHECK ("properties"."address_published_precision" in ('exact', 'building', 'street'));
