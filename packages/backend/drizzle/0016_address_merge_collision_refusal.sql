-- oxy:deploy-phase=pre
--
-- #360 — a merge REFUSES on a unique collision instead of leaving the row behind.
--
-- `left_in_place` and `blocked_by_constraint` are gone from
-- `address_merge_relation_moves`. The earlier design left a colliding review on
-- the losing address and recorded that it stayed, on the ground that nothing was
-- discarded — which was true and still wrong: a review list reads
-- `where address_id = <place>`, so a row left on the loser is INVISIBLE on the
-- survivor. Refusing the whole merge and naming the collision loses nothing and
-- hides nothing.
--
-- PRE, and safe to apply ahead of the rollout because NO ROW CAN CARRY THE
-- DROPPED VALUE: `address_merges` was created in 0015, nothing has ever called
-- the service (a merge is an operational act, not a request side effect), and
-- `0015` shipped hours ago. Verified against the live table before generating:
-- zero rows. If that ever stops being true, this needs a data migration first.

ALTER TABLE "address_merge_relation_moves" DROP CONSTRAINT "address_merge_relation_moves_blocked_coherence_check";--> statement-breakpoint
ALTER TABLE "address_merge_relation_moves" DROP CONSTRAINT "address_merge_relation_moves_outcome_check";--> statement-breakpoint
ALTER TABLE "address_merge_relation_moves" DROP COLUMN "blocked_by_constraint";--> statement-breakpoint
ALTER TABLE "address_merge_relation_moves" ADD CONSTRAINT "address_merge_relation_moves_outcome_check" CHECK ("address_merge_relation_moves"."outcome" in ('moved'));
