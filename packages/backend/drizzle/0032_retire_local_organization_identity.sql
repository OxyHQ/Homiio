-- oxy:deploy-phase=post
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM agencies a LEFT JOIN agency_identity_archives e ON e.agency_id = a.id
    WHERE a.name IS NOT NULL AND (e.id IS NULL OR ROW(a.name,a.normalized_name) IS DISTINCT FROM ROW(e.observed_name,e.normalized_name))) THEN
    RAISE EXCEPTION 'Frozen agency evidence is missing or changed';
  END IF;
END $$;
--> statement-breakpoint
DROP TRIGGER agencies_identity_frozen ON agencies;
--> statement-breakpoint
DROP FUNCTION homiio_agency_identity_frozen();
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM eviction_organizations o LEFT JOIN eviction_organization_identity_archives a ON a.organization_id=o.id WHERE o.name IS NOT NULL AND (a.id IS NULL OR ROW(o.name,o.normalized_name) IS DISTINCT FROM ROW(a.observed_name,a.normalized_name))) THEN
  RAISE EXCEPTION 'Frozen support organization evidence is missing or changed';
 END IF;
END $$;
--> statement-breakpoint
DROP TRIGGER support_identity_frozen ON eviction_organizations;
--> statement-breakpoint
DROP FUNCTION homiio_support_identity_frozen();
--> statement-breakpoint
ALTER TABLE "agencies" DROP CONSTRAINT "agencies_normalized_name_not_empty_check";--> statement-breakpoint
DROP INDEX "agencies_normalized_name_key";--> statement-breakpoint
DROP INDEX "agencies_name_trgm_idx";--> statement-breakpoint
DROP INDEX "eviction_organizations_normalized_name_key";--> statement-breakpoint
ALTER TABLE "agencies" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "agencies" DROP COLUMN "normalized_name";--> statement-breakpoint
ALTER TABLE "eviction_organizations" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "eviction_organizations" DROP COLUMN "normalized_name";