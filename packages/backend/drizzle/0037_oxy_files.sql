-- oxy:deploy-phase=pre
CREATE TABLE "file_reference_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_file_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "file_reference_changes_entity_type_check" CHECK ("file_reference_changes"."entity_type" in ('property', 'city', 'region', 'eviction_case')),
	CONSTRAINT "file_reference_changes_generation_check" CHECK ("file_reference_changes"."generation" > 0)
);
--> statement-breakpoint
CREATE TABLE "legacy_media_reads" (
	"id" text PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"surface" text NOT NULL,
	"outcome" text NOT NULL,
	"reads" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "legacy_media_reads_surface_check" CHECK ("legacy_media_reads"."surface" in ('public_image', 'private_document')),
	CONSTRAINT "legacy_media_reads_outcome_check" CHECK ("legacy_media_reads"."outcome" in ('redirected', 'served', 'missing')),
	CONSTRAINT "legacy_media_reads_reads_check" CHECK ("legacy_media_reads"."reads" >= 0)
);
--> statement-breakpoint
CREATE TABLE "oxy_file_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"oxy_file_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "oxy_file_events_type_check" CHECK ("oxy_file_events"."type" in ('file.deleted', 'file.visibility_changed', 'file.trashed', 'file.restored', 'file.blocked', 'file.unblocked'))
);
--> statement-breakpoint
ALTER TABLE "images" DROP CONSTRAINT "images_entity_type_check";--> statement-breakpoint
ALTER TABLE "images" ALTER COLUMN "keys_original" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "images" ALTER COLUMN "keys_small" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "images" ALTER COLUMN "keys_medium" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "images" ALTER COLUMN "keys_large" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "oxy_file_id" text;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "oxy_file_owner" text;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "oxy_file_status" text;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "oxy_file_visibility" text;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "oxy_file_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "attribution_source_url" text;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "attribution_author" text;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "attribution_license" text;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "attribution_license_url" text;--> statement-breakpoint
CREATE INDEX "file_reference_changes_pending_idx" ON "file_reference_changes" USING btree ("available_at") WHERE "file_reference_changes"."settled_at" is null;--> statement-breakpoint
CREATE INDEX "file_reference_changes_settled_at_idx" ON "file_reference_changes" USING btree ("settled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_media_reads_day_surface_outcome_key" ON "legacy_media_reads" USING btree ("day","surface","outcome");--> statement-breakpoint
CREATE INDEX "oxy_file_events_expires_at_idx" ON "oxy_file_events" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "cities_cover_image_id_idx" ON "cities" USING btree ("cover_image_id");--> statement-breakpoint
CREATE INDEX "eviction_cases_cover_image_id_idx" ON "eviction_cases" USING btree ("cover_image_id");--> statement-breakpoint
CREATE INDEX "images_oxy_file_id_idx" ON "images" USING btree ("oxy_file_id");--> statement-breakpoint
CREATE INDEX "images_migrated_keys_original_idx" ON "images" USING btree ("keys_original") WHERE "images"."oxy_file_id" is not null;--> statement-breakpoint
CREATE INDEX "regions_cover_image_id_idx" ON "regions" USING btree ("cover_image_id");--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_oxy_file_owner_check" CHECK ("images"."oxy_file_owner" in ('application', 'account'));--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_oxy_file_status_check" CHECK ("images"."oxy_file_status" in ('active', 'trash', 'blocked', 'deleted'));--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_oxy_file_visibility_check" CHECK ("images"."oxy_file_visibility" in ('public', 'unlisted', 'private'));--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_storage_check" CHECK ((
        "images"."oxy_file_id" is not null and "images"."oxy_file_owner" is not null
          and "images"."oxy_file_status" is not null and "images"."oxy_file_visibility" is not null
      ) or (
        "images"."oxy_file_id" is null and "images"."oxy_file_owner" is null
          and "images"."oxy_file_status" is null and "images"."oxy_file_visibility" is null
          and "images"."keys_original" is not null and "images"."keys_small" is not null
          and "images"."keys_medium" is not null and "images"."keys_large" is not null
      ));--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_attribution_check" CHECK ((
        "images"."attribution_source_url" is null and "images"."attribution_license" is null
          and "images"."attribution_author" is null and "images"."attribution_license_url" is null
      ) or (
        "images"."attribution_source_url" is not null and "images"."attribution_license" is not null
      ));--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_entity_type_check" CHECK ("images"."entity_type" in ('property', 'city', 'region', 'country', 'profile', 'eviction_case'));--> statement-breakpoint
-- ─── Hand-written: the triggers that mark a (file, entity) pair for the drain ───
-- drizzle-kit does not model triggers; a regeneration DROPS these, so after
-- any regeneration re-append them (db/schema/oxyFiles.ts says why they exist,
-- __tests__/db/fileReferenceChanges.test.ts pins each one).
CREATE FUNCTION homiio_mark_file_reference(p_file_id text, p_entity_type text, p_entity_id text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO file_reference_changes (id, oxy_file_id, entity_type, entity_id)
  SELECT p_entity_type || ':' || p_entity_id || ':' || p_file_id, p_file_id, p_entity_type, p_entity_id
  WHERE p_file_id IS NOT NULL AND p_entity_id IS NOT NULL
  ON CONFLICT (id) DO UPDATE SET
    generation = file_reference_changes.generation + 1,
    settled_at = NULL,
    available_at = CASE
      WHEN file_reference_changes.settled_at IS NOT NULL THEN date_trunc('milliseconds', now())
      ELSE least(file_reference_changes.available_at, date_trunc('milliseconds', now()))
    END,
    updated_at = date_trunc('milliseconds', now())
$$;--> statement-breakpoint
CREATE FUNCTION homiio_property_images_file_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM homiio_mark_file_reference(i.oxy_file_id, 'property', OLD.property_id) FROM images i WHERE i.id = OLD.image_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM homiio_mark_file_reference(i.oxy_file_id, 'property', NEW.property_id) FROM images i WHERE i.id = NEW.image_id;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER property_images_file_reference AFTER INSERT OR DELETE OR UPDATE OF image_id, property_id ON property_images FOR EACH ROW EXECUTE FUNCTION homiio_property_images_file_reference();--> statement-breakpoint
CREATE FUNCTION homiio_cover_file_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.cover_image_id IS NOT NULL THEN
    PERFORM homiio_mark_file_reference(i.oxy_file_id, TG_ARGV[0], OLD.id) FROM images i WHERE i.id = OLD.cover_image_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.cover_image_id IS NOT NULL THEN
    PERFORM homiio_mark_file_reference(i.oxy_file_id, TG_ARGV[0], NEW.id) FROM images i WHERE i.id = NEW.cover_image_id;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER cities_cover_file_reference AFTER INSERT OR DELETE OR UPDATE OF cover_image_id ON cities FOR EACH ROW EXECUTE FUNCTION homiio_cover_file_reference('city');--> statement-breakpoint
CREATE TRIGGER regions_cover_file_reference AFTER INSERT OR DELETE OR UPDATE OF cover_image_id ON regions FOR EACH ROW EXECUTE FUNCTION homiio_cover_file_reference('region');--> statement-breakpoint
CREATE TRIGGER eviction_cases_cover_file_reference AFTER INSERT OR DELETE OR UPDATE OF cover_image_id ON eviction_cases FOR EACH ROW EXECUTE FUNCTION homiio_cover_file_reference('eviction_case');--> statement-breakpoint
-- An images row's own change: a migration giving it its Oxy file, or its
-- deletion. BEFORE, because a cover pointing at a deleted row loses the pointer
-- through ON DELETE SET NULL, and by then the row naming the file is gone.
CREATE FUNCTION homiio_images_file_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  file_ids text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    file_ids := ARRAY[OLD.oxy_file_id];
  ELSIF OLD.oxy_file_id IS DISTINCT FROM NEW.oxy_file_id THEN
    file_ids := ARRAY[OLD.oxy_file_id, NEW.oxy_file_id];
  ELSE
    RETURN NEW;
  END IF;
  PERFORM homiio_mark_file_reference(f, 'property', pi.property_id) FROM unnest(file_ids) AS f, property_images pi WHERE pi.image_id = OLD.id;
  PERFORM homiio_mark_file_reference(f, 'city', c.id) FROM unnest(file_ids) AS f, cities c WHERE c.cover_image_id = OLD.id;
  PERFORM homiio_mark_file_reference(f, 'region', r.id) FROM unnest(file_ids) AS f, regions r WHERE r.cover_image_id = OLD.id;
  PERFORM homiio_mark_file_reference(f, 'eviction_case', e.id) FROM unnest(file_ids) AS f, eviction_cases e WHERE e.cover_image_id = OLD.id;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER images_file_reference BEFORE DELETE OR UPDATE OF oxy_file_id ON images FOR EACH ROW EXECUTE FUNCTION homiio_images_file_reference();
