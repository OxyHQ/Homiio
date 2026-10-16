-- oxy:deploy-phase=pre
CREATE TABLE "capability_effect_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text NOT NULL,
	"tool" text NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"input_digest" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "capability_effect_receipts_status_check" CHECK ("capability_effect_receipts"."status" in ('pending', 'completed')),
	CONSTRAINT "capability_effect_receipts_completed_check" CHECK (("capability_effect_receipts"."status" = 'completed') = ("capability_effect_receipts"."completed_at" is not null and "capability_effect_receipts"."result" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "capability_effect_receipts_key_unique" ON "capability_effect_receipts" USING btree ("oxy_user_id","tool","idempotency_key_hash");--> statement-breakpoint
CREATE INDEX "capability_effect_receipts_expires_at_idx" ON "capability_effect_receipts" USING btree ("expires_at");