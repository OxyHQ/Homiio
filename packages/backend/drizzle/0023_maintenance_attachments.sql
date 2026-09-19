-- oxy:deploy-phase=pre
--
-- Photos on a repair request (#518 §7.1, #519 §7.1) — the open half of the
-- maintenance domain, which was recorded as blocked on "a private object path
-- that does not exist". The store always existed; the AUTHORIZING path did not,
-- and now does, so this is the row that points into it.
--
-- PRE: one CREATE TABLE and one foreign key into a table that already exists.
-- Nothing an old image is serving can break by it being there, and the new
-- image needs it the moment it starts.
--
-- The `private/%` CHECK is the one line here worth reading twice. The delivery
-- route refuses any key that is not under a private prefix, so a row written
-- with a public key would not fail — it would 404 at the moment a tenant taps a
-- thumbnail, which is the worst time to find out. The constraint moves that to
-- the INSERT.

CREATE TABLE "maintenance_request_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"uploaded_by_oxy_user_id" text NOT NULL,
	"role" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "maintenance_request_attachments_role_check" CHECK ("maintenance_request_attachments"."role" in ('tenant', 'landlord')),
	CONSTRAINT "maintenance_request_attachments_private_key_check" CHECK ("maintenance_request_attachments"."storage_key" like 'private/%'),
	CONSTRAINT "maintenance_request_attachments_bytes_check" CHECK ("maintenance_request_attachments"."bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "maintenance_request_attachments" ADD CONSTRAINT "maintenance_request_attachments_request_id_maintenance_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."maintenance_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_request_attachments_request_created_idx" ON "maintenance_request_attachments" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_request_attachments_storage_key" ON "maintenance_request_attachments" USING btree ("storage_key");