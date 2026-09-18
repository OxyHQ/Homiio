-- oxy:deploy-phase=pre
--
-- ADR 0001 §8.1 — a correction that changes a KEY field of a canonical address
-- is a merge PROPOSAL, not an edit. `PUT /api/addresses/:id` used to write all
-- eight identity fields (`street`, `number`, `building_name`, `block`,
-- `entrance`, `floor`, `unit`, `subunit`) for ANY signed-in caller, with no
-- ownership predicate at all, so one request could re-key the permanent identity
-- of a dwelling that listings, leases, reviews and eviction cases all point at.
-- Those fields leave the direct-write allowlist in this change and land here.
--
-- PRE, and additive only: one new table, no change to any existing one. The
-- outgoing image never names it, so its presence is invisible to anything still
-- serving the previous release, and nothing in it is read until the incoming
-- image's `/api/addresses/:id/corrections` routes are live.
--
-- Two indexes, and the partial one is the load-bearing half. Its predicate —
-- `where status = 'open'` — is what lets a proposer withdraw a correction and
-- later file it again; a TOTAL unique index passes every "refuses a duplicate"
-- assertion and silently refuses that second, legitimate filing forever, which
-- is the failure `__tests__/db/partialUniques.test.ts` exists to catch and why
-- the new index is named in its catalogue. Any `ON CONFLICT` naming it must
-- repeat the predicate verbatim, or Postgres answers 42P10 at runtime with a
-- clean `tsc`.
--
-- The coherence CHECK spells `is not null` out on its positive branch rather
-- than relying on the tidier form: a CHECK rejects only an explicit FALSE, so
-- `(status = 'open' and withdrawn_at is null) or (status = 'withdrawn')` would
-- evaluate to NULL for a withdrawn row with no instant and ADMIT exactly the
-- half-state it exists to refuse. `CONVENTIONS.md` records that shipping once.

CREATE TABLE "address_merge_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"from_address_id" text NOT NULL,
	"to_address_id" text,
	"proposed_street" text NOT NULL,
	"proposed_number" text,
	"proposed_building_name" text,
	"proposed_block" text,
	"proposed_entrance" text,
	"proposed_floor" text,
	"proposed_unit" text,
	"proposed_subunit" text,
	"proposed_address_level" text NOT NULL,
	"proposed_identity_key" text NOT NULL,
	"normalization_version" integer NOT NULL,
	"reason" text NOT NULL,
	"evidence_url" text,
	"proposed_by_oxy_user_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "address_merge_proposals_status_check" CHECK ("address_merge_proposals"."status" in ('open', 'withdrawn')),
	CONSTRAINT "address_merge_proposals_level_check" CHECK ("address_merge_proposals"."proposed_address_level" in ('STREET', 'BUILDING', 'UNIT')),
	CONSTRAINT "address_merge_proposals_not_self_check" CHECK ("address_merge_proposals"."to_address_id" is null or "address_merge_proposals"."to_address_id" <> "address_merge_proposals"."from_address_id"),
	CONSTRAINT "address_merge_proposals_withdrawn_coherence_check" CHECK (("address_merge_proposals"."status" = 'open' and "address_merge_proposals"."withdrawn_at" is null)
          or ("address_merge_proposals"."status" = 'withdrawn' and "address_merge_proposals"."withdrawn_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "address_merge_proposals" ADD CONSTRAINT "address_merge_proposals_from_address_id_addresses_id_fk" FOREIGN KEY ("from_address_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "address_merge_proposals" ADD CONSTRAINT "address_merge_proposals_to_address_id_addresses_id_fk" FOREIGN KEY ("to_address_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "address_merge_proposals_from_idx" ON "address_merge_proposals" USING btree ("from_address_id","created_at" desc) WHERE "address_merge_proposals"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "address_merge_proposals_open_key" ON "address_merge_proposals" USING btree ("from_address_id","proposed_by_oxy_user_id","proposed_identity_key") WHERE "address_merge_proposals"."status" = 'open';