-- oxy:deploy-phase=pre
--
-- #360 — the candidate → canonical boundary: address candidates, provider refs
-- and the materialization audit trail, plus the three additive columns on
-- `addresses` that the materialization chokepoint cannot be built without.
--
-- `pre`, and it is the easy kind of `pre` rather than the traded kind that
-- `0013` had to argue for: every statement below is ADDITIVE and every new
-- column on an existing table is NULLABLE with no default. The outgoing image
-- does not name one of them, so its INSERTs stay legal for the whole rollout
-- window; the incoming image needs them from its first request. Nothing here
-- rewrites a value, drops a column, or narrows a vocabulary, so there is no
-- window in which either image is writing something the other refuses.
--
-- The three columns on `addresses` are ADR 0001 phase 1 (§9), landed here
-- because `materializeHousingCandidate` is the first thing that can write them:
--
--   `identity_key`        the LEVEL-AWARE dedup key. The v1 `normalized_key`
--                         hashes neither `floor` nor `entrance` nor `subunit`
--                         while `address_level` derives FROM them, so a
--                         building and its third-floor flat collapse onto one
--                         row today (ADR 0001 §1.3, measured). Both columns
--                         stay live; `normalized_key` is untouched and is still
--                         what `findOrCreateCanonicalAddress` dedupes on.
--   `parent_address_id`   the street → building → unit chain, stored instead of
--                         re-projected per review.
--   `merged_into_address_id`  the merge redirect. Nothing performs a merge yet;
--                         the matcher honours the pointer from its first line so
--                         that a redirect landing later cannot start handing
--                         callers a row a merge retired.
--
-- No backfill. Every existing row keeps `identity_key`, `parent_address_id` and
-- `merged_into_address_id` NULL, which is the honest state: the ADR's plan is
-- forward-only and populating them is phase 2, gated on a census that has not
-- run.
--
CREATE TABLE "address_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"submitted_by_oxy_user_id" text,
	"provider" text NOT NULL,
	"provider_ref" text,
	"raw_text" text NOT NULL,
	"raw_text_hash" text NOT NULL,
	"normalized_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"normalization_version" integer NOT NULL,
	"longitude" double precision,
	"latitude" double precision,
	"precision" text NOT NULL,
	"proposed_country_code" text,
	"proposed_country" text,
	"proposed_region" text,
	"proposed_city" text,
	"proposed_neighborhood" text,
	"proposed_street" text,
	"proposed_postal_code" text,
	"proposed_number" text,
	"proposed_building_name" text,
	"proposed_block" text,
	"proposed_entrance" text,
	"proposed_floor" text,
	"proposed_unit" text,
	"proposed_subunit" text,
	"origin" text NOT NULL,
	"source_url" text,
	"confidence" double precision,
	"expires_at" timestamp with time zone NOT NULL,
	"materialized_address_id" text,
	"materialized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "address_candidates_precision_check" CHECK ("address_candidates"."precision" in ('exact', 'approximate', 'centroid', 'area')),
	CONSTRAINT "address_candidates_origin_check" CHECK ("address_candidates"."origin" in ('user_typed', 'autocomplete_selection', 'map_pin', 'geocoder', 'listing_ingest', 'public_dataset', 'approved_correction')),
	CONSTRAINT "address_candidates_coordinates_check" CHECK (("address_candidates"."longitude" is null and "address_candidates"."latitude" is null)
          or ("address_candidates"."longitude" is not null and "address_candidates"."latitude" is not null
              and "address_candidates"."longitude" between -180 and 180
              and "address_candidates"."latitude" between -90 and 90)),
	CONSTRAINT "address_candidates_materialized_coherence_check" CHECK (("address_candidates"."materialized_address_id" is null and "address_candidates"."materialized_at" is null)
          or ("address_candidates"."materialized_address_id" is not null and "address_candidates"."materialized_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "address_external_refs" (
	"id" text PRIMARY KEY NOT NULL,
	"address_id" text NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"source_url" text,
	"raw_label" text,
	"confidence" double precision,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "address_external_refs_confidence_range_check" CHECK ("address_external_refs"."confidence" between 0 and 1),
	CONSTRAINT "address_external_refs_seen_order_check" CHECK ("address_external_refs"."last_seen_at" >= "address_external_refs"."first_seen_at")
);
--> statement-breakpoint
CREATE TABLE "address_materializations" (
	"id" text PRIMARY KEY NOT NULL,
	"address_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"raw_text" text NOT NULL,
	"raw_text_hash" text NOT NULL,
	"normalization_version" integer NOT NULL,
	"match_kind" text NOT NULL,
	"match_detail" text,
	"identity_key" text,
	"durable_action" text NOT NULL,
	"durable_action_ref" text,
	"actor_oxy_user_id" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "address_materializations_match_kind_check" CHECK ("address_materializations"."match_kind" in ('created', 'exact_identity_key', 'exact_external_ref', 'adopted_v1_key', 'confirmed_probable')),
	CONSTRAINT "address_materializations_durable_action_check" CHECK ("address_materializations"."durable_action" in ('listing_upsert', 'review', 'follow_dwelling', 'public_data_link', 'canonical_event', 'approved_correction'))
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN "identity_key" text;--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN "parent_address_id" text;--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN "merged_into_address_id" text;--> statement-breakpoint
ALTER TABLE "address_candidates" ADD CONSTRAINT "address_candidates_materialized_address_id_addresses_id_fk" FOREIGN KEY ("materialized_address_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "address_external_refs" ADD CONSTRAINT "address_external_refs_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "address_materializations" ADD CONSTRAINT "address_materializations_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "address_candidates_submitter_raw_text_idx" ON "address_candidates" USING btree ("submitted_by_oxy_user_id","raw_text_hash");--> statement-breakpoint
CREATE INDEX "address_candidates_provider_ref_idx" ON "address_candidates" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "address_candidates_expires_at_idx" ON "address_candidates" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "address_candidates_materialized_address_id_idx" ON "address_candidates" USING btree ("materialized_address_id");--> statement-breakpoint
CREATE UNIQUE INDEX "address_external_refs_source_external_id_key" ON "address_external_refs" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "address_external_refs_address_id_idx" ON "address_external_refs" USING btree ("address_id");--> statement-breakpoint
CREATE UNIQUE INDEX "address_materializations_idempotency_key" ON "address_materializations" USING btree ("idempotency_key") WHERE "address_materializations"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "address_materializations_address_id_idx" ON "address_materializations" USING btree ("address_id");--> statement-breakpoint
CREATE INDEX "address_materializations_candidate_id_idx" ON "address_materializations" USING btree ("candidate_id");--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_parent_address_id_addresses_id_fk" FOREIGN KEY ("parent_address_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_merged_into_address_id_addresses_id_fk" FOREIGN KEY ("merged_into_address_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "addresses_identity_key_key" ON "addresses" USING btree ("identity_key") WHERE "addresses"."identity_key" is not null;--> statement-breakpoint
CREATE INDEX "addresses_parent_address_id_idx" ON "addresses" USING btree ("parent_address_id");--> statement-breakpoint
CREATE INDEX "addresses_merged_into_address_id_idx" ON "addresses" USING btree ("merged_into_address_id") WHERE "addresses"."merged_into_address_id" is not null;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_parent_not_self_check" CHECK ("addresses"."parent_address_id" <> "addresses"."id");--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_merge_not_self_check" CHECK ("addresses"."merged_into_address_id" <> "addresses"."id");