-- oxy:deploy-phase=pre
--
-- Repair requests (#518 §7.1, #519 §7.1) — a NEW domain, not a port. Homiio had
-- no maintenance anything; `lease_inspections` is a landlord's scheduled
-- walkthrough, which is a different fact reported by a different person about a
-- building that is not yet broken.
--
-- PRE, and the reason is the ordinary one: these are three CREATE TABLEs and two
-- new foreign keys, so nothing an old image is serving can be broken by them
-- existing. The API lane applies `--phase=pre` before `update-service`, so the
-- tables are there when the new image starts reading them.
--
-- The two CHECKs worth reading before changing them:
--
--   `maintenance_requests_scheduled_coherence_check` is TWO-WAY. A scheduled
--   repair with no date is a promise with no day in it; a date on an `open`
--   request reads as an appointment nobody made. Both render confidently.
--
--   `maintenance_requests_resolved_at_check` is ONE-WAY, and that asymmetry is
--   deliberate. `resolved_at` survives a reopen — "this was declared fixed on
--   the 3rd and was not" is the fact a tenant needs — so a two-way CHECK would
--   forbid the reopened state this domain exists to support.

CREATE TABLE "maintenance_request_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"oxy_user_id" text NOT NULL,
	"role" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "maintenance_request_comments_role_check" CHECK ("maintenance_request_comments"."role" in ('tenant', 'landlord'))
);
--> statement-breakpoint
CREATE TABLE "maintenance_request_events" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"oxy_user_id" text NOT NULL,
	"role" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "maintenance_request_events_role_check" CHECK ("maintenance_request_events"."role" in ('tenant', 'landlord')),
	CONSTRAINT "maintenance_request_events_from_check" CHECK ("maintenance_request_events"."from_status" is null or "maintenance_request_events"."from_status" in ('open', 'acknowledged', 'scheduled', 'resolved', 'closed', 'declined')),
	CONSTRAINT "maintenance_request_events_to_check" CHECK ("maintenance_request_events"."to_status" in ('open', 'acknowledged', 'scheduled', 'resolved', 'closed', 'declined'))
);
--> statement-breakpoint
CREATE TABLE "maintenance_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"lease_id" text NOT NULL,
	"property_id" text NOT NULL,
	"reported_by_oxy_user_id" text NOT NULL,
	"category" text NOT NULL,
	"urgency" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"scheduled_for" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "maintenance_requests_category_check" CHECK ("maintenance_requests"."category" in ('plumbing', 'electrical', 'heating', 'appliance', 'structural', 'pest', 'security', 'other')),
	CONSTRAINT "maintenance_requests_urgency_check" CHECK ("maintenance_requests"."urgency" in ('low', 'normal', 'high', 'emergency')),
	CONSTRAINT "maintenance_requests_status_check" CHECK ("maintenance_requests"."status" in ('open', 'acknowledged', 'scheduled', 'resolved', 'closed', 'declined')),
	CONSTRAINT "maintenance_requests_scheduled_coherence_check" CHECK (("maintenance_requests"."status" = 'scheduled') = ("maintenance_requests"."scheduled_for" is not null)),
	CONSTRAINT "maintenance_requests_resolved_at_check" CHECK ("maintenance_requests"."status" <> 'resolved' or "maintenance_requests"."resolved_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "maintenance_request_comments" ADD CONSTRAINT "maintenance_request_comments_request_id_maintenance_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."maintenance_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_request_events" ADD CONSTRAINT "maintenance_request_events_request_id_maintenance_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."maintenance_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_request_comments_request_created_idx" ON "maintenance_request_comments" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "maintenance_request_events_request_created_idx" ON "maintenance_request_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "maintenance_requests_lease_created_idx" ON "maintenance_requests" USING btree ("lease_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "maintenance_requests_property_open_idx" ON "maintenance_requests" USING btree ("property_id","created_at" desc) WHERE "maintenance_requests"."status" not in ('closed', 'declined');