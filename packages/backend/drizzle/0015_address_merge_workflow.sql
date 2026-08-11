-- oxy:deploy-phase=pre
--
-- #360 — merging two canonical addresses, reversibly. `address_merges` is the
-- act (survivor, loser, actor, reason, and the count of relations it moved) and
-- `address_merge_relation_moves` is the itemised log a revert replays backwards.
--
-- PRE, and additive only: two new tables and no change to any existing one, so
-- an image still serving the previous release is unaffected by their presence.
-- Nothing writes them until `services/addressMerge.ts` is called, and nothing
-- calls it yet — a merge is an operational act, never a request side effect.
--
-- The partial unique index is the load-bearing one: a row may lose at most one
-- merge that is still in force, and `where status = 'applied'` is what allows a
-- row to be merged, reverted and merged again. Any `ON CONFLICT` naming it must
-- repeat that predicate verbatim or Postgres answers 42P10 at runtime.

CREATE TABLE "address_merge_relation_moves" (
	"id" text PRIMARY KEY NOT NULL,
	"merge_id" text NOT NULL,
	"relation_table" text NOT NULL,
	"relation_column" text NOT NULL,
	"relation_row_id" text NOT NULL,
	"previous_address_id" text NOT NULL,
	"outcome" text NOT NULL,
	"blocked_by_constraint" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "address_merge_relation_moves_outcome_check" CHECK ("address_merge_relation_moves"."outcome" in ('moved', 'left_in_place')),
	CONSTRAINT "address_merge_relation_moves_blocked_coherence_check" CHECK (("address_merge_relation_moves"."outcome" = 'moved' and "address_merge_relation_moves"."blocked_by_constraint" is null)
          or ("address_merge_relation_moves"."outcome" = 'left_in_place' and "address_merge_relation_moves"."blocked_by_constraint" is not null))
);
--> statement-breakpoint
CREATE TABLE "address_merges" (
	"id" text PRIMARY KEY NOT NULL,
	"survivor_address_id" text NOT NULL,
	"merged_address_id" text NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"reason_code" text NOT NULL,
	"reason" text NOT NULL,
	"evidence_url" text,
	"actor_oxy_user_id" text,
	"moved_relation_count" integer NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	"reverted_at" timestamp with time zone,
	"reverted_by_oxy_user_id" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "address_merges_status_check" CHECK ("address_merges"."status" in ('applied', 'reverted')),
	CONSTRAINT "address_merges_reason_code_check" CHECK ("address_merges"."reason_code" in ('duplicate_identity_key', 'duplicate_external_ref', 'approved_correction', 'ingest_duplicate')),
	CONSTRAINT "address_merges_not_self_check" CHECK ("address_merges"."survivor_address_id" <> "address_merges"."merged_address_id"),
	CONSTRAINT "address_merges_reverted_coherence_check" CHECK (("address_merges"."status" = 'applied' and "address_merges"."reverted_at" is null)
          or ("address_merges"."status" = 'reverted' and "address_merges"."reverted_at" is not null)),
	CONSTRAINT "address_merges_moved_count_check" CHECK ("address_merges"."moved_relation_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "address_merge_relation_moves" ADD CONSTRAINT "address_merge_relation_moves_merge_id_address_merges_id_fk" FOREIGN KEY ("merge_id") REFERENCES "public"."address_merges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "address_merge_relation_moves" ADD CONSTRAINT "address_merge_relation_moves_previous_address_id_addresses_id_fk" FOREIGN KEY ("previous_address_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "address_merges" ADD CONSTRAINT "address_merges_survivor_address_id_addresses_id_fk" FOREIGN KEY ("survivor_address_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "address_merges" ADD CONSTRAINT "address_merges_merged_address_id_addresses_id_fk" FOREIGN KEY ("merged_address_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "address_merge_relation_moves_merge_idx" ON "address_merge_relation_moves" USING btree ("merge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "address_merge_relation_moves_row_key" ON "address_merge_relation_moves" USING btree ("merge_id","relation_table","relation_column","relation_row_id");--> statement-breakpoint
CREATE UNIQUE INDEX "address_merges_active_loser_key" ON "address_merges" USING btree ("merged_address_id") WHERE "address_merges"."status" = 'applied';--> statement-breakpoint
CREATE INDEX "address_merges_survivor_idx" ON "address_merges" USING btree ("survivor_address_id");--> statement-breakpoint
CREATE INDEX "address_merges_merged_idx" ON "address_merges" USING btree ("merged_address_id");
