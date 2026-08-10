-- oxy:deploy-phase=pre
--
-- #358 — the solidarity board becomes local, privacy-preserving and updateable.
--
-- `pre`, and the choice is a trade rather than a free one. This migration
-- REPLACES the `location_precision` vocabulary ('exact' | 'approximate' →
-- 'street' | 'neighborhood' | 'approximate_radius') and the eviction report
-- reason vocabulary, so during a rolling deploy exactly one of the two images
-- is writing values the CHECK constraints refuse. `pre` makes that the OUTGOING
-- image, for the length of the rollout, rather than the incoming one — an
-- incoming image that cannot write is a failure that persists if the migration
-- task is delayed, while an outgoing one that cannot write is a failure that
-- ends when the rollout does.
--
-- Every new column that the outgoing image does not name carries a DEFAULT for
-- the same reason, so its INSERTs stay legal. The one exception is
-- `eviction_case_updates.position`, which is per-case and cannot have a
-- meaningful constant default: an outgoing image appending a timeline entry
-- during the rollout window gets a NOT NULL violation. Recorded rather than
-- engineered around, because the alternative (a defaulting trigger that exists
-- for a two-minute window) is machinery whose reason nobody will find later.
--
-- The eviction tables were measured EMPTY in production on 2026-08-09
-- (`db/evictions/evictionRepository.ts`'s header records the count). That fact
-- carries a date because it is exactly the kind that stops being true quietly —
-- RE-VERIFY IT BEFORE DEPLOYING. The backfills below are written to be correct
-- whether or not it still holds.

CREATE TABLE "eviction_case_followers" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"oxy_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eviction_case_help_needs" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"need_type" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "eviction_case_help_needs_type_check" CHECK ("eviction_case_help_needs"."need_type" in ('presence', 'legal_support', 'translation', 'transport', 'temporary_housing', 'outreach', 'organization_contact'))
);
--> statement-breakpoint
CREATE TABLE "eviction_location_access_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"actor_oxy_user_id" text NOT NULL,
	"action" text NOT NULL,
	"purpose" text,
	"denial_reason" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "eviction_location_access_audit_action_check" CHECK ("eviction_location_access_audit"."action" in ('granted', 'revoked', 'read', 'denied')),
	CONSTRAINT "eviction_location_access_audit_denial_check" CHECK (("eviction_location_access_audit"."action" = 'denied') = ("eviction_location_access_audit"."denial_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "eviction_location_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"grantee_oxy_user_id" text NOT NULL,
	"granted_by_oxy_user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "eviction_location_grants_purpose_check" CHECK ("eviction_location_grants"."purpose" in ('legal_representation', 'accompaniment', 'emergency_housing')),
	CONSTRAINT "eviction_location_grants_window_check" CHECK ("eviction_location_grants"."expires_at" > "eviction_location_grants"."granted_at")
);
--> statement-breakpoint
CREATE TABLE "eviction_organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"description" text,
	"public_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"verification_source" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "eviction_organizations_verified_source_check" CHECK ("eviction_organizations"."verified_at" is null or "eviction_organizations"."verification_source" is not null)
);
--> statement-breakpoint
CREATE TABLE "eviction_supporter_vouches" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"voucher_oxy_user_id" text NOT NULL,
	"vouched_oxy_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "eviction_supporter_vouches_distinct_check" CHECK ("eviction_supporter_vouches"."voucher_oxy_user_id" <> "eviction_supporter_vouches"."vouched_oxy_user_id")
);
--> statement-breakpoint
CREATE TABLE "eviction_update_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"update_id" text NOT NULL,
	"recipient_oxy_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jurisdiction_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"country_code" text NOT NULL,
	"region_id" text,
	"resource_type" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	"languages" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "jurisdiction_resources_type_check" CHECK ("jurisdiction_resources"."resource_type" in ('legal_aid', 'tenant_union', 'emergency_housing', 'official_info')),
	CONSTRAINT "jurisdiction_resources_languages_check" CHECK (cardinality("jurisdiction_resources"."languages") >= 1),
	CONSTRAINT "jurisdiction_resources_validity_check" CHECK ("jurisdiction_resources"."valid_until" is null or "jurisdiction_resources"."valid_until" > "jurisdiction_resources"."verified_at")
);
--> statement-breakpoint
ALTER TABLE "eviction_cases" DROP CONSTRAINT "eviction_cases_location_precision_check";--> statement-breakpoint
ALTER TABLE "eviction_reports" DROP CONSTRAINT "eviction_reports_reason_check";--> statement-breakpoint
--> statement-breakpoint
-- The old precision vocabulary has no member the new one accepts. Both legacy
-- values described a coordinate that was published as if it were a point, which
-- is precisely what `approximate_radius` replaces, so every existing row lands
-- there and gets the default (widest) radius from the column added below.
UPDATE "eviction_cases" SET "location_precision" = 'approximate_radius'
  WHERE "location_precision" NOT IN ('street', 'neighborhood', 'approximate_radius');--> statement-breakpoint
-- The eviction report reasons stop borrowing the listing vocabulary. Mapped
-- rather than dropped so a report that was filed is still a report that exists;
-- `inaccurate`, `scam` and `other` all collapse onto `false_information`
-- because none of them asserts anything narrower about an eviction notice.
UPDATE "eviction_reports" SET "reason" = CASE "reason"
    WHEN 'privacy' THEN 'personal_data_exposed'
    WHEN 'unsafe' THEN 'dangerous_contact'
    WHEN 'inappropriate' THEN 'harassment'
    WHEN 'unavailable' THEN 'outdated'
    ELSE 'false_information'
  END
  WHERE "reason" NOT IN ('false_information', 'personal_data_exposed',
    'location_too_precise', 'outdated', 'harassment', 'spam',
    'dangerous_contact');
DROP INDEX "eviction_case_updates_case_created_idx";--> statement-breakpoint
ALTER TABLE "eviction_cases" ALTER COLUMN "location_precision" SET DEFAULT 'approximate_radius';--> statement-breakpoint
ALTER TABLE "eviction_case_attendees" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eviction_case_attendees" ADD COLUMN "confirmation_basis" text;--> statement-breakpoint
ALTER TABLE "eviction_case_attendees" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eviction_case_updates" ADD COLUMN "position" bigint;--> statement-breakpoint
-- Backfilled by creation order within each case, which is the order the old
-- timeline was read in, so an existing case's entries keep the sequence people
-- already saw. `row_number()` starts at 1, matching the `>= 1` CHECK below.
UPDATE "eviction_case_updates" AS u
  SET "position" = ranked.rn
  FROM (
    SELECT "id", row_number() OVER (PARTITION BY "case_id" ORDER BY "created_at", "id") AS rn
    FROM "eviction_case_updates"
  ) AS ranked
  WHERE u."id" = ranked."id" AND u."position" IS NULL;--> statement-breakpoint
ALTER TABLE "eviction_case_updates" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "eviction_case_updates" ADD COLUMN "event_type" text DEFAULT 'note' NOT NULL;--> statement-breakpoint
ALTER TABLE "eviction_case_updates" ADD COLUMN "actor_oxy_user_id" text;--> statement-breakpoint
ALTER TABLE "eviction_cases" ADD COLUMN "location_radius_meters" integer DEFAULT 2500 NOT NULL;--> statement-breakpoint
ALTER TABLE "eviction_cases" ADD COLUMN "location_exact_longitude" double precision;--> statement-breakpoint
ALTER TABLE "eviction_cases" ADD COLUMN "location_exact_latitude" double precision;--> statement-breakpoint
ALTER TABLE "eviction_cases" ADD COLUMN "location_exact_address" text;--> statement-breakpoint
ALTER TABLE "eviction_cases" ADD COLUMN "location_household_authorized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eviction_cases" ADD COLUMN "precautionary_hold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eviction_cases" ADD COLUMN "disputed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eviction_cases" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "eviction_cases" ADD COLUMN "contact_unlock_min_tenure_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "eviction_cases" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eviction_case_followers" ADD CONSTRAINT "eviction_case_followers_case_id_eviction_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eviction_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eviction_case_help_needs" ADD CONSTRAINT "eviction_case_help_needs_case_id_eviction_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eviction_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eviction_location_access_audit" ADD CONSTRAINT "eviction_location_access_audit_case_id_eviction_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eviction_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eviction_location_grants" ADD CONSTRAINT "eviction_location_grants_case_id_eviction_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eviction_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eviction_supporter_vouches" ADD CONSTRAINT "eviction_supporter_vouches_case_id_eviction_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eviction_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eviction_update_notifications" ADD CONSTRAINT "eviction_update_notifications_update_id_eviction_case_updates_id_fk" FOREIGN KEY ("update_id") REFERENCES "public"."eviction_case_updates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jurisdiction_resources" ADD CONSTRAINT "jurisdiction_resources_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eviction_case_followers_case_user_key" ON "eviction_case_followers" USING btree ("case_id","oxy_user_id");--> statement-breakpoint
CREATE INDEX "eviction_case_followers_user_idx" ON "eviction_case_followers" USING btree ("oxy_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eviction_case_help_needs_key" ON "eviction_case_help_needs" USING btree ("case_id","need_type");--> statement-breakpoint
CREATE INDEX "eviction_case_help_needs_type_idx" ON "eviction_case_help_needs" USING btree ("need_type");--> statement-breakpoint
CREATE INDEX "eviction_location_access_audit_case_created_idx" ON "eviction_location_access_audit" USING btree ("case_id","created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "eviction_location_grants_live_key" ON "eviction_location_grants" USING btree ("case_id","grantee_oxy_user_id") WHERE "eviction_location_grants"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "eviction_location_grants_case_idx" ON "eviction_location_grants" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eviction_organizations_normalized_name_key" ON "eviction_organizations" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "eviction_supporter_vouches_key" ON "eviction_supporter_vouches" USING btree ("case_id","voucher_oxy_user_id","vouched_oxy_user_id");--> statement-breakpoint
CREATE INDEX "eviction_supporter_vouches_vouched_idx" ON "eviction_supporter_vouches" USING btree ("case_id","vouched_oxy_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eviction_update_notifications_key" ON "eviction_update_notifications" USING btree ("update_id","recipient_oxy_user_id");--> statement-breakpoint
CREATE INDEX "jurisdiction_resources_country_type_idx" ON "jurisdiction_resources" USING btree ("country_code","resource_type");--> statement-breakpoint
CREATE INDEX "jurisdiction_resources_region_idx" ON "jurisdiction_resources" USING btree ("region_id") WHERE "jurisdiction_resources"."region_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "jurisdiction_resources_country_url_key" ON "jurisdiction_resources" USING btree ("country_code","url");--> statement-breakpoint
ALTER TABLE "eviction_cases" ADD CONSTRAINT "eviction_cases_organization_id_eviction_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."eviction_organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eviction_case_updates_case_position_idx" ON "eviction_case_updates" USING btree ("case_id","position" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "eviction_case_updates_case_position_key" ON "eviction_case_updates" USING btree ("case_id","position");--> statement-breakpoint
CREATE INDEX "eviction_cases_updated_idx" ON "eviction_cases" USING btree ("updated_at" desc);--> statement-breakpoint
CREATE INDEX "eviction_cases_organization_id_idx" ON "eviction_cases" USING btree ("organization_id") WHERE "eviction_cases"."organization_id" is not null;--> statement-breakpoint
ALTER TABLE "eviction_case_attendees" ADD CONSTRAINT "eviction_case_attendees_confirmation_check" CHECK (("eviction_case_attendees"."confirmed_at" is null) = ("eviction_case_attendees"."confirmation_basis" is null));--> statement-breakpoint
ALTER TABLE "eviction_case_updates" ADD CONSTRAINT "eviction_case_updates_event_type_check" CHECK ("eviction_case_updates"."event_type" in ('case_created', 'date_changed', 'location_precision_changed', 'instructions_updated', 'postponed', 'stopped', 'executed', 'cancelled', 'legal_resource_added', 'organization_verified', 'correction_published', 'precautionary_hold_applied', 'note'));--> statement-breakpoint
ALTER TABLE "eviction_case_updates" ADD CONSTRAINT "eviction_case_updates_position_check" CHECK ("eviction_case_updates"."position" >= 1);--> statement-breakpoint
ALTER TABLE "eviction_cases" ADD CONSTRAINT "eviction_cases_exact_coordinates_range_check" CHECK (("eviction_cases"."location_exact_longitude" is null
            or "eviction_cases"."location_exact_longitude" between -180 and 180)
        and ("eviction_cases"."location_exact_latitude" is null
            or "eviction_cases"."location_exact_latitude" between -90 and 90));--> statement-breakpoint
ALTER TABLE "eviction_cases" ADD CONSTRAINT "eviction_cases_exact_location_authorized_check" CHECK (("eviction_cases"."location_exact_longitude" is null) = ("eviction_cases"."location_exact_latitude" is null)
        and (
          "eviction_cases"."location_household_authorized_at" is not null
          or ("eviction_cases"."location_exact_longitude" is null
              and "eviction_cases"."location_exact_address" is null)
        ));--> statement-breakpoint
ALTER TABLE "eviction_cases" ADD CONSTRAINT "eviction_cases_radius_positive_check" CHECK ("eviction_cases"."location_radius_meters" > 0);--> statement-breakpoint
ALTER TABLE "eviction_cases" ADD CONSTRAINT "eviction_cases_contact_tenure_check" CHECK ("eviction_cases"."contact_unlock_min_tenure_days" >= 0);--> statement-breakpoint
ALTER TABLE "eviction_cases" ADD CONSTRAINT "eviction_cases_location_precision_check" CHECK ("eviction_cases"."location_precision" in ('street', 'neighborhood', 'approximate_radius'));--> statement-breakpoint
ALTER TABLE "eviction_reports" ADD CONSTRAINT "eviction_reports_reason_check" CHECK ("eviction_reports"."reason" in ('false_information', 'personal_data_exposed', 'location_too_precise', 'outdated', 'harassment', 'spam', 'dangerous_contact'));
--> statement-breakpoint
-- The timeline is an AUDIT, so the table refuses to be rewritten.
--
-- No route edits an entry today, but "no route" is a property of this week's
-- controllers and this is a property of the table. A status that was later
-- corrected must still show what was published at the time; silently rewriting
-- the original is the failure ADR 0003 §7 and #358 both name.
--
-- `BEFORE UPDATE` only. `DELETE` is deliberately left alone: the case's
-- `ON DELETE CASCADE` needs it, and an organiser deleting their own notice is a
-- decision this board explicitly allows.
CREATE OR REPLACE FUNCTION eviction_case_updates_refuse_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'eviction_case_updates is append-only: entry % cannot be modified', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER eviction_case_updates_immutable
  BEFORE UPDATE ON "eviction_case_updates"
  FOR EACH ROW EXECUTE FUNCTION eviction_case_updates_refuse_update();
