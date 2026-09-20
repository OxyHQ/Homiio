-- oxy:deploy-phase=pre
--
-- A signature binds to what was signed, and the timeline is made of events
-- (#518 §7.4, #519 §7.4).
--
-- §7.4: "Las firmas se vinculan a la versión/documento mostrados y a los
-- participantes; el timeline muestra eventos reales." Neither held. A signature
-- was six columns on `leases` — two booleans, two dates and two strings the
-- CLIENT supplied (`app/contracts/[id].tsx` sent the literal
-- `'accepted-in-app'`) — naming no document, no version and no content, and a
-- co-tenant could not sign at all. The timeline was rebuilt on every render out
-- of `created_at`, those two booleans and the term dates, so uploading a
-- document or serving a termination notice left no trace anybody could see.
--
-- PRE: two new tables and one nullable column. Nothing existing is altered in a
-- way the running image can notice — it writes none of this, and every row it
-- can still write satisfies every constraint below.
--
-- THE THREE BINDINGS ARE EXPRESSED AS CONSTRAINTS, NOT LEFT TO CALLERS. A
-- signature may name no document (both columns null), a document whose bytes
-- are recorded (both set), or a document that predates content hashing (an id
-- with no digest). The composite foreign key
-- `(document_id, document_sha256) -> lease_documents(id, content_sha256)` is
-- MATCH SIMPLE, which Postgres satisfies whenever any column of the key is
-- null — so the third shape is admitted deliberately while the second is
-- CHECKED against the document's real digest, and the single-column foreign key
-- beside it still proves the document exists. The one shape with no meaning, a
-- digest naming no document, is refused outright.
--
-- `terms_sha256` is NOT NULL, because a lease may have no document but always
-- has terms, and a landlord may still amend a lease that is awaiting
-- signatures. It is the column that makes a stale signature VISIBLE instead of
-- letting an amendment silently inherit one.
--
-- Both tables are APPEND-ONLY by trigger. A signature that can be UPDATEd binds
-- to nothing, because the binding itself is editable; a timeline that can be
-- rewritten is not a history. `DELETE` is left alone on both: the lease's own
-- `ON DELETE CASCADE` needs it.

CREATE TABLE "lease_signatures" (
	"id" text PRIMARY KEY NOT NULL,
	"lease_id" text NOT NULL,
	"signer_oxy_user_id" text NOT NULL,
	"party" text NOT NULL,
	"method" text DEFAULT 'in_app_acceptance' NOT NULL,
	"signed_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"terms_sha256" text NOT NULL,
	"document_id" text,
	"document_sha256" text,
	CONSTRAINT "lease_signatures_party_check" CHECK ("lease_signatures"."party" in ('landlord', 'tenant', 'co_tenant')),
	CONSTRAINT "lease_signatures_method_check" CHECK ("lease_signatures"."method" in ('in_app_acceptance')),
	CONSTRAINT "lease_signatures_terms_sha256_check" CHECK ("lease_signatures"."terms_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "lease_signatures_document_hash_check" CHECK ("lease_signatures"."document_sha256" is null or "lease_signatures"."document_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "lease_events" (
	"id" text PRIMARY KEY NOT NULL,
	"lease_id" text NOT NULL,
	"position" bigint NOT NULL,
	"event_type" text NOT NULL,
	"actor_oxy_user_id" text,
	"detail" text,
	"occurred_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "lease_events_type_check" CHECK ("lease_events"."event_type" in ('created', 'amended', 'signed', 'activated', 'document_added', 'terminated', 'renewed')),
	CONSTRAINT "lease_events_position_check" CHECK ("lease_events"."position" >= 1)
);
--> statement-breakpoint
ALTER TABLE "lease_documents" ADD COLUMN "content_sha256" text;--> statement-breakpoint
-- Declared BEFORE the composite foreign key below, and the order is not
-- cosmetic: Postgres refuses `REFERENCES lease_documents(id, content_sha256)`
-- with "there is no unique constraint matching given keys" until a unique index
-- over exactly those columns exists. drizzle-kit emits constraints ahead of
-- indexes, so this statement is moved by hand.
CREATE UNIQUE INDEX "lease_documents_id_content_key" ON "lease_documents" USING btree ("id","content_sha256");--> statement-breakpoint
ALTER TABLE "lease_documents" ADD CONSTRAINT "lease_documents_content_sha256_check" CHECK ("lease_documents"."content_sha256" is null or "lease_documents"."content_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "lease_signatures" ADD CONSTRAINT "lease_signatures_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_signatures" ADD CONSTRAINT "lease_signatures_document_id_lease_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."lease_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_signatures" ADD CONSTRAINT "lease_signatures_document_content_fk" FOREIGN KEY ("document_id","document_sha256") REFERENCES "public"."lease_documents"("id","content_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lease_events" ADD CONSTRAINT "lease_events_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lease_signatures_lease_signer_key" ON "lease_signatures" USING btree ("lease_id","signer_oxy_user_id");--> statement-breakpoint
CREATE INDEX "lease_signatures_lease_signed_idx" ON "lease_signatures" USING btree ("lease_id","signed_at");--> statement-breakpoint
CREATE INDEX "lease_events_lease_position_idx" ON "lease_events" USING btree ("lease_id","position" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "lease_events_lease_position_key" ON "lease_events" USING btree ("lease_id","position");--> statement-breakpoint
-- Append-only, both tables. Hand-written: drizzle has no trigger DDL, and the
-- schema file records that these exist here.
CREATE OR REPLACE FUNCTION lease_signatures_refuse_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'lease_signatures is append-only: signature % cannot be modified', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER lease_signatures_immutable
  BEFORE UPDATE ON "lease_signatures"
  FOR EACH ROW EXECUTE FUNCTION lease_signatures_refuse_update();--> statement-breakpoint
CREATE OR REPLACE FUNCTION lease_events_refuse_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'lease_events is append-only: entry % cannot be modified', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER lease_events_immutable
  BEFORE UPDATE ON "lease_events"
  FOR EACH ROW EXECUTE FUNCTION lease_events_refuse_update();
