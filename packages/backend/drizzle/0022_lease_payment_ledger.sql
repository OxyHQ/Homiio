-- oxy:deploy-phase=pre
--
-- The rent LEDGER (#518 §7.2, #519 §7.2). `lease_payment_schedule` lists what
-- is OWED; this lists what actually moved — attempts, confirmed payments,
-- manual declarations, partials and refunds — because several of those are
-- MANY per obligation and a row that can hold one loses the rest.
--
-- PRE: one CREATE TABLE and three foreign keys into tables that already exist.
-- Nothing an old image is serving can break by them being there, and the new
-- image needs them the moment it starts.
--
-- The two unique indexes carry the idempotency guarantee, and they are not
-- interchangeable:
--
--   `..._idempotency_key` is (lease_id, idempotency_key) and answers a double
--   tap, a retry and a checkout return — the caller supplies the same key.
--
--   `..._processor_reference_key` is PARTIAL on `processor_reference is not
--   null`, and answers a replayed or out-of-order webhook, where the caller is
--   the processor and has no idea what key Homiio used. A TOTAL unique index
--   here would permit exactly one declaration in the whole table, since every
--   declaration's reference is null.
--
-- `..._refund_target_check` and `..._confirmed_check` are both TWO-WAY on
-- purpose: a refund with nothing to reverse is money leaving against no record,
-- a payment carrying a reversal pointer is counted twice by anything walking
-- the chain, and a confirmation date on a movement that did not succeed is a
-- date a screen will render beside a payment that never happened.
--
-- `reverses_movement_id` is a SELF-referencing foreign key with CASCADE: a
-- refund of a payment that no longer exists is a movement with no subject, and
-- the lease's own cascade removes both together anyway.

CREATE TABLE "lease_payment_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"lease_id" text NOT NULL,
	"obligation_id" text NOT NULL,
	"direction" text DEFAULT 'payment' NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"amount" double precision NOT NULL,
	"currency" text NOT NULL,
	"created_by_oxy_user_id" text NOT NULL,
	"confirmed_by_oxy_user_id" text,
	"confirmed_at" timestamp with time zone,
	"processor_reference" text,
	"failure_reason" text,
	"reverses_movement_id" text,
	"note" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "lease_payment_movements_direction_check" CHECK ("lease_payment_movements"."direction" in ('payment', 'refund')),
	CONSTRAINT "lease_payment_movements_kind_check" CHECK ("lease_payment_movements"."kind" in ('manual_declaration', 'processor')),
	CONSTRAINT "lease_payment_movements_state_check" CHECK ("lease_payment_movements"."state" in ('initiated', 'pending', 'succeeded', 'failed')),
	CONSTRAINT "lease_payment_movements_amount_check" CHECK ("lease_payment_movements"."amount" > 0),
	CONSTRAINT "lease_payment_movements_refund_target_check" CHECK (("lease_payment_movements"."direction" = 'refund') = ("lease_payment_movements"."reverses_movement_id" is not null)),
	CONSTRAINT "lease_payment_movements_confirmed_check" CHECK (("lease_payment_movements"."state" = 'succeeded') = ("lease_payment_movements"."confirmed_at" is not null)),
	CONSTRAINT "lease_payment_movements_failure_check" CHECK ("lease_payment_movements"."state" <> 'failed' or "lease_payment_movements"."failure_reason" is not null),
	CONSTRAINT "lease_payment_movements_declaration_check" CHECK ("lease_payment_movements"."kind" <> 'manual_declaration' or "lease_payment_movements"."processor_reference" is null)
);
--> statement-breakpoint
ALTER TABLE "lease_payment_movements" ADD CONSTRAINT "lease_payment_movements_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_payment_movements" ADD CONSTRAINT "lease_payment_movements_obligation_id_lease_payment_schedule_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."lease_payment_schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_payment_movements" ADD CONSTRAINT "lease_payment_movements_reverses_movement_id_lease_payment_movements_id_fk" FOREIGN KEY ("reverses_movement_id") REFERENCES "public"."lease_payment_movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lease_payment_movements_obligation_idx" ON "lease_payment_movements" USING btree ("obligation_id","created_at");--> statement-breakpoint
CREATE INDEX "lease_payment_movements_lease_idx" ON "lease_payment_movements" USING btree ("lease_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lease_payment_movements_idempotency_key" ON "lease_payment_movements" USING btree ("lease_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "lease_payment_movements_processor_reference_key" ON "lease_payment_movements" USING btree ("processor_reference") WHERE "lease_payment_movements"."processor_reference" is not null;