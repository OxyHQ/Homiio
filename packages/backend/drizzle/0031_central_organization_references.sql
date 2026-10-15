-- oxy:deploy-phase=pre
CREATE TABLE "agency_identity_archives" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"observed_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"archived_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eviction_organization_identity_archives" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"observed_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"archived_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agencies" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agencies" ALTER COLUMN "normalized_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "eviction_organizations" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "eviction_organizations" ALTER COLUMN "normalized_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "oxy_account_id" text;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "identity_status" text DEFAULT 'unresolved' NOT NULL;--> statement-breakpoint
ALTER TABLE "eviction_organizations" ADD COLUMN "oxy_account_id" text;--> statement-breakpoint
ALTER TABLE "eviction_organizations" ADD COLUMN "identity_status" text DEFAULT 'unresolved' NOT NULL;--> statement-breakpoint
ALTER TABLE "agency_identity_archives" ADD CONSTRAINT "agency_identity_archives_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eviction_organization_identity_archives" ADD CONSTRAINT "eviction_organization_identity_archives_organization_id_eviction_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."eviction_organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agency_identity_archives_agency_id_key" ON "agency_identity_archives" USING btree ("agency_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eviction_org_identity_archives_organization_id_key" ON "eviction_organization_identity_archives" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agencies_oxy_account_id_idx" ON "agencies" USING btree ("oxy_account_id");--> statement-breakpoint
CREATE INDEX "eviction_organizations_oxy_account_id_idx" ON "eviction_organizations" USING btree ("oxy_account_id");--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_identity_status_check" CHECK ("agencies"."identity_status" in ('unresolved', 'linked', 'not_organization'));--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_identity_link_check" CHECK (("agencies"."identity_status" = 'linked') = ("agencies"."oxy_account_id" is not null));--> statement-breakpoint
ALTER TABLE "eviction_organizations" ADD CONSTRAINT "eviction_organizations_identity_status_check" CHECK ("eviction_organizations"."identity_status" in ('unresolved','linked','not_organization'));--> statement-breakpoint
ALTER TABLE "eviction_organizations" ADD CONSTRAINT "eviction_organizations_identity_link_check" CHECK (("eviction_organizations"."identity_status" = 'linked') = ("eviction_organizations"."oxy_account_id" is not null));
--> statement-breakpoint
INSERT INTO agency_identity_archives(id, agency_id, observed_name, normalized_name)
SELECT id, id, name, normalized_name FROM agencies;
--> statement-breakpoint
CREATE FUNCTION homiio_agency_identity_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.identity_status <> 'linked' OR NEW.oxy_account_id IS NULL OR NEW.name IS NOT NULL OR NEW.normalized_name IS NOT NULL THEN
      RAISE EXCEPTION 'New agency references require a canonical Oxy organization';
    END IF;
  ELSIF ROW(NEW.name, NEW.normalized_name) IS DISTINCT FROM ROW(OLD.name, OLD.normalized_name) THEN
    RAISE EXCEPTION 'Company identity is owned by Oxy';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER agencies_identity_frozen BEFORE INSERT OR UPDATE ON agencies FOR EACH ROW EXECUTE FUNCTION homiio_agency_identity_frozen();
--> statement-breakpoint
CREATE FUNCTION homiio_agency_archive_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Agency identity source evidence is immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER agency_identity_archives_immutable BEFORE UPDATE OR DELETE ON agency_identity_archives FOR EACH ROW EXECUTE FUNCTION homiio_agency_archive_immutable();

--> statement-breakpoint
INSERT INTO eviction_organization_identity_archives(id,organization_id,observed_name,normalized_name)
SELECT id,id,name,normalized_name FROM eviction_organizations;
--> statement-breakpoint
CREATE FUNCTION homiio_support_identity_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.identity_status <> 'linked' OR NEW.oxy_account_id IS NULL OR NEW.name IS NOT NULL OR NEW.normalized_name IS NOT NULL THEN
   RAISE EXCEPTION 'New support references require canonical Oxy identity';
  END IF;
 ELSIF ROW(NEW.name,NEW.normalized_name) IS DISTINCT FROM ROW(OLD.name,OLD.normalized_name) THEN
  RAISE EXCEPTION 'Organization identity is owned by Oxy';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER support_identity_frozen BEFORE INSERT OR UPDATE ON eviction_organizations FOR EACH ROW EXECUTE FUNCTION homiio_support_identity_frozen();
--> statement-breakpoint
CREATE TRIGGER support_identity_archive_immutable BEFORE UPDATE OR DELETE ON eviction_organization_identity_archives FOR EACH ROW EXECUTE FUNCTION homiio_agency_archive_immutable();
