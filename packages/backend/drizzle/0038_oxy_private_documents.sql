-- oxy:deploy-phase=pre
ALTER TABLE "file_reference_changes" DROP CONSTRAINT "file_reference_changes_entity_type_check";--> statement-breakpoint
ALTER TABLE "maintenance_request_attachments" DROP CONSTRAINT "maintenance_request_attachments_private_key_check";--> statement-breakpoint
ALTER TABLE "file_reference_changes" ADD CONSTRAINT "file_reference_changes_entity_type_check" CHECK ("file_reference_changes"."entity_type" in ('property', 'city', 'region', 'eviction_case', 'lease', 'tenant_application', 'maintenance_request'));--> statement-breakpoint
ALTER TABLE "maintenance_request_attachments" ADD CONSTRAINT "maintenance_request_attachments_private_key_check" CHECK ("maintenance_request_attachments"."storage_key" like 'private/%' or "maintenance_request_attachments"."storage_key" ~ '^oxy:[A-Za-z0-9_-]{1,128}$');--> statement-breakpoint
-- ─── Hand-written: the triggers that mark a private document's (file, entity) pair ───
-- drizzle-kit does not model triggers; a regeneration DROPS these, so after
-- any regeneration re-append them (services/files/referenceUsage.ts says what
-- "in use" means, __tests__/db/privateDocumentReferences.test.ts pins each one).
-- A document row names its Oxy file as `oxy:<fileId>` in one text column; a
-- bucket key (`private/…`, or a delivery-route URL) names none and marks nothing.
-- TG_ARGV: [0] the reference entity type, [1] the ref column, [2] the entity column.
CREATE FUNCTION homiio_private_document_file_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_row jsonb;
  new_row jsonb;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    old_row := to_jsonb(OLD);
    IF old_row ->> TG_ARGV[1] LIKE 'oxy:%' THEN
      PERFORM homiio_mark_file_reference(substr(old_row ->> TG_ARGV[1], 5), TG_ARGV[0], old_row ->> TG_ARGV[2]);
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    new_row := to_jsonb(NEW);
    IF new_row ->> TG_ARGV[1] LIKE 'oxy:%' THEN
      PERFORM homiio_mark_file_reference(substr(new_row ->> TG_ARGV[1], 5), TG_ARGV[0], new_row ->> TG_ARGV[2]);
    END IF;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER lease_documents_file_reference AFTER INSERT OR DELETE OR UPDATE OF url, lease_id ON lease_documents FOR EACH ROW EXECUTE FUNCTION homiio_private_document_file_reference('lease', 'url', 'lease_id');--> statement-breakpoint
CREATE TRIGGER tenant_application_documents_file_reference AFTER INSERT OR DELETE OR UPDATE OF url, application_id ON tenant_application_documents FOR EACH ROW EXECUTE FUNCTION homiio_private_document_file_reference('tenant_application', 'url', 'application_id');--> statement-breakpoint
CREATE TRIGGER maintenance_request_attachments_file_reference AFTER INSERT OR DELETE OR UPDATE OF storage_key, request_id ON maintenance_request_attachments FOR EACH ROW EXECUTE FUNCTION homiio_private_document_file_reference('maintenance_request', 'storage_key', 'request_id');
