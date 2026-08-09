-- oxy:deploy-phase=pre
--
-- `reviews` (+ two child tables), `listing_reports`, `eviction_cases` (+ two),
-- `eviction_comments`, `eviction_reports`, `roommate_requests` and
-- `roommate_relationships` — the community surfaces.
--
-- PHASE: `pre`. Purely additive — eleven new tables, no drop, no rename and no
-- change to anything earlier migrations created. All eleven collections are
-- EMPTY in production.
--
-- The SECOND and last PostGIS column in the migration lands here:
-- `eviction_cases.location_geo`, `GENERATED ALWAYS AS
-- (ST_MakePoint(location_longitude, location_latitude)::geography) STORED`,
-- with a GiST index — the port of Mongo's `{ 'location.coordinates':
-- '2dsphere' }`. It depends on the `postgis` extension `db/extensions.ts`
-- installs before any migration runs, exactly as `addresses.geo` does.
--
CREATE TABLE "eviction_case_attendees" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"oxy_user_id" text NOT NULL,
	"rsvped_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eviction_case_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"message" text NOT NULL,
	"new_scheduled_at" timestamp with time zone,
	"new_status" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "eviction_case_updates_new_status_check" CHECK ("eviction_case_updates"."new_status" in ('upcoming', 'stopped', 'postponed', 'executed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "eviction_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"location_label" text NOT NULL,
	"location_longitude" double precision NOT NULL,
	"location_latitude" double precision NOT NULL,
	"location_geo" "geography" GENERATED ALWAYS AS (ST_MakePoint(location_longitude, location_latitude)::geography) STORED,
	"location_precision" text DEFAULT 'approximate' NOT NULL,
	"location_city" text,
	"location_country_code" text,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"agency_id" text,
	"contact_phone" text,
	"contact_email" text,
	"contact_telegram" text,
	"contact_whatsapp" text,
	"contact_instructions" text,
	"cover_image_id" text,
	"cover_image_url" text,
	"outcome_reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "eviction_cases_status_check" CHECK ("eviction_cases"."status" in ('upcoming', 'stopped', 'postponed', 'executed', 'cancelled')),
	CONSTRAINT "eviction_cases_location_precision_check" CHECK ("eviction_cases"."location_precision" in ('exact', 'approximate')),
	CONSTRAINT "eviction_cases_coordinates_range_check" CHECK ("eviction_cases"."location_longitude" between -180 and 180
        and "eviction_cases"."location_latitude" between -90 and 90)
);
--> statement-breakpoint
CREATE TABLE "eviction_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"oxy_user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eviction_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"reporter_oxy_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"contact_email" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "eviction_reports_reason_check" CHECK ("eviction_reports"."reason" in ('inaccurate', 'scam', 'inappropriate', 'unavailable', 'privacy', 'unsafe', 'other')),
	CONSTRAINT "eviction_reports_status_check" CHECK ("eviction_reports"."status" in ('open', 'reviewing', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "listing_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"reporter_oxy_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"contact_email" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "listing_reports_reason_check" CHECK ("listing_reports"."reason" in ('inaccurate', 'scam', 'inappropriate', 'unavailable', 'privacy', 'unsafe', 'other')),
	CONSTRAINT "listing_reports_status_check" CHECK ("listing_reports"."status" in ('open', 'reviewing', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "review_helpful_votes" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"oxy_user_id" text NOT NULL,
	"voted_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"oxy_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "review_reports_reason_check" CHECK ("review_reports"."reason" in ('fake', 'offensive', 'personal_data', 'spam', 'other'))
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"address_id" text NOT NULL,
	"address_level" text NOT NULL,
	"street_level_id" text NOT NULL,
	"building_level_id" text NOT NULL,
	"unit_level_id" text,
	"city_id" text,
	"neighborhood_id" text,
	"agency_id" text,
	"title" text,
	"green_house" text,
	"price" double precision NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"lived_from" timestamp with time zone NOT NULL,
	"lived_to" timestamp with time zone NOT NULL,
	"lived_for_months" bigint NOT NULL,
	"recommendation" boolean NOT NULL,
	"opinion" text NOT NULL,
	"pros_items" text[] DEFAULT '{}'::text[] NOT NULL,
	"cons_items" text[] DEFAULT '{}'::text[] NOT NULL,
	"advice_to_agency" text,
	"advice_to_landlord" text,
	"positive_comment" text,
	"negative_comment" text,
	"images" text[] DEFAULT '{}'::text[] NOT NULL,
	"rating" bigint NOT NULL,
	"summer_temperature" text,
	"winter_temperature" text,
	"noise" text,
	"light" text,
	"condition_and_maintenance" text,
	"services" text[] DEFAULT '{}'::text[] NOT NULL,
	"landlord_treatment" text,
	"problem_response" text,
	"deposit_returned" text,
	"staircase_neighbors" text,
	"tourist_apartments" boolean,
	"neighbor_relations" text,
	"cleaning" text,
	"area_tourists" text,
	"area_security" text,
	"area_noise" text,
	"area_cleanliness" text,
	"moderation_status" text DEFAULT 'active' NOT NULL,
	"oxy_user_id" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "reviews_address_level_check" CHECK ("reviews"."address_level" in ('BUILDING', 'UNIT')),
	CONSTRAINT "reviews_unit_level_check" CHECK (("reviews"."address_level" = 'UNIT') = ("reviews"."unit_level_id" is not null)),
	CONSTRAINT "reviews_moderation_status_check" CHECK ("reviews"."moderation_status" in ('active', 'under_review', 'removed')),
	CONSTRAINT "reviews_currency_check" CHECK ("reviews"."currency" in ('USD', 'EUR', 'GBP', 'CAD')),
	CONSTRAINT "reviews_summer_temperature_check" CHECK ("reviews"."summer_temperature" in ('very_cold', 'cold', 'moderate', 'warm', 'very_warm')),
	CONSTRAINT "reviews_winter_temperature_check" CHECK ("reviews"."winter_temperature" in ('very_cold', 'cold', 'moderate', 'warm', 'very_warm')),
	CONSTRAINT "reviews_noise_check" CHECK ("reviews"."noise" in ('very_quiet', 'quiet', 'moderate', 'noisy', 'very_noisy')),
	CONSTRAINT "reviews_light_check" CHECK ("reviews"."light" in ('very_dark', 'dark', 'moderate', 'bright', 'very_bright')),
	CONSTRAINT "reviews_condition_check" CHECK ("reviews"."condition_and_maintenance" in ('poor', 'fair', 'good', 'very_good', 'excellent')),
	CONSTRAINT "reviews_services_check" CHECK ("reviews"."services" <@ array['internet', 'cable_tv', 'parking', 'laundry', 'gym', 'pool', 'concierge', 'security', 'maintenance', 'cleaning']::text[]),
	CONSTRAINT "reviews_landlord_treatment_check" CHECK ("reviews"."landlord_treatment" in ('very_poor', 'poor', 'fair', 'good', 'excellent')),
	CONSTRAINT "reviews_problem_response_check" CHECK ("reviews"."problem_response" in ('never_responded', 'very_slow', 'slow', 'reasonable', 'fast', 'very_fast')),
	CONSTRAINT "reviews_deposit_returned_check" CHECK ("reviews"."deposit_returned" in ('full', 'partial', 'no')),
	CONSTRAINT "reviews_staircase_neighbors_check" CHECK ("reviews"."staircase_neighbors" in ('very_unfriendly', 'unfriendly', 'neutral', 'friendly', 'very_friendly')),
	CONSTRAINT "reviews_neighbor_relations_check" CHECK ("reviews"."neighbor_relations" in ('very_poor', 'poor', 'fair', 'good', 'excellent')),
	CONSTRAINT "reviews_cleaning_check" CHECK ("reviews"."cleaning" in ('very_dirty', 'dirty', 'acceptable', 'clean', 'very_clean')),
	CONSTRAINT "reviews_area_tourists_check" CHECK ("reviews"."area_tourists" in ('none', 'few', 'moderate', 'many', 'overwhelming')),
	CONSTRAINT "reviews_area_security_check" CHECK ("reviews"."area_security" in ('very_unsafe', 'unsafe', 'neutral', 'safe', 'very_safe')),
	CONSTRAINT "reviews_area_noise_check" CHECK ("reviews"."area_noise" in ('very_quiet', 'quiet', 'moderate', 'noisy', 'very_noisy')),
	CONSTRAINT "reviews_area_cleanliness_check" CHECK ("reviews"."area_cleanliness" in ('very_dirty', 'dirty', 'acceptable', 'clean', 'very_clean')),
	CONSTRAINT "reviews_rating_check" CHECK ("reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_lived_order_check" CHECK ("reviews"."lived_to" > "reviews"."lived_from")
);
--> statement-breakpoint
CREATE TABLE "roommate_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user1_id" text NOT NULL,
	"oxy_user2_id" text NOT NULL,
	"request_id" text,
	"match_score" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "roommate_relationships_status_check" CHECK ("roommate_relationships"."status" in ('active', 'ended')),
	CONSTRAINT "roommate_relationships_sorted_pair_check" CHECK ("roommate_relationships"."oxy_user1_id" < "roommate_relationships"."oxy_user2_id"),
	CONSTRAINT "roommate_relationships_match_score_check" CHECK ("roommate_relationships"."match_score" between 0 and 100),
	CONSTRAINT "roommate_relationships_order_check" CHECK ("roommate_relationships"."end_date" is null or "roommate_relationships"."end_date" >= "roommate_relationships"."start_date")
);
--> statement-breakpoint
CREATE TABLE "roommate_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"from_oxy_user_id" text NOT NULL,
	"to_oxy_user_id" text NOT NULL,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "roommate_requests_status_check" CHECK ("roommate_requests"."status" in ('pending', 'accepted', 'declined')),
	CONSTRAINT "roommate_requests_distinct_parties_check" CHECK ("roommate_requests"."from_oxy_user_id" <> "roommate_requests"."to_oxy_user_id")
);
--> statement-breakpoint
ALTER TABLE "eviction_case_attendees" ADD CONSTRAINT "eviction_case_attendees_case_id_eviction_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eviction_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eviction_case_updates" ADD CONSTRAINT "eviction_case_updates_case_id_eviction_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eviction_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eviction_cases" ADD CONSTRAINT "eviction_cases_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eviction_cases" ADD CONSTRAINT "eviction_cases_cover_image_id_images_id_fk" FOREIGN KEY ("cover_image_id") REFERENCES "public"."images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eviction_comments" ADD CONSTRAINT "eviction_comments_case_id_eviction_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eviction_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eviction_reports" ADD CONSTRAINT "eviction_reports_case_id_eviction_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eviction_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_reports" ADD CONSTRAINT "listing_reports_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_helpful_votes" ADD CONSTRAINT "review_helpful_votes_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_street_level_id_addresses_id_fk" FOREIGN KEY ("street_level_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_building_level_id_addresses_id_fk" FOREIGN KEY ("building_level_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_unit_level_id_addresses_id_fk" FOREIGN KEY ("unit_level_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_neighborhood_id_neighborhoods_id_fk" FOREIGN KEY ("neighborhood_id") REFERENCES "public"."neighborhoods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roommate_relationships" ADD CONSTRAINT "roommate_relationships_request_id_roommate_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."roommate_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eviction_case_attendees_case_user_key" ON "eviction_case_attendees" USING btree ("case_id","oxy_user_id");--> statement-breakpoint
CREATE INDEX "eviction_case_updates_case_created_idx" ON "eviction_case_updates" USING btree ("case_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "eviction_cases_status_scheduled_idx" ON "eviction_cases" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "eviction_cases_oxy_user_created_idx" ON "eviction_cases" USING btree ("oxy_user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "eviction_cases_location_geo_gist" ON "eviction_cases" USING gist ("location_geo");--> statement-breakpoint
CREATE INDEX "eviction_cases_agency_id_idx" ON "eviction_cases" USING btree ("agency_id") WHERE "eviction_cases"."agency_id" is not null;--> statement-breakpoint
CREATE INDEX "eviction_comments_case_created_idx" ON "eviction_comments" USING btree ("case_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "eviction_comments_oxy_user_id_idx" ON "eviction_comments" USING btree ("oxy_user_id");--> statement-breakpoint
CREATE INDEX "eviction_reports_status_created_idx" ON "eviction_reports" USING btree ("status","created_at" desc);--> statement-breakpoint
CREATE INDEX "eviction_reports_case_status_idx" ON "eviction_reports" USING btree ("case_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "eviction_reports_open_reporter_key" ON "eviction_reports" USING btree ("case_id","reporter_oxy_user_id") WHERE "eviction_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "listing_reports_status_created_idx" ON "listing_reports" USING btree ("status","created_at" desc);--> statement-breakpoint
CREATE INDEX "listing_reports_property_status_idx" ON "listing_reports" USING btree ("property_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_reports_open_reporter_key" ON "listing_reports" USING btree ("property_id","reporter_oxy_user_id") WHERE "listing_reports"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "review_helpful_votes_review_user_key" ON "review_helpful_votes" USING btree ("review_id","oxy_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_reports_review_user_key" ON "review_reports" USING btree ("review_id","oxy_user_id");--> statement-breakpoint
CREATE INDEX "reviews_address_created_idx" ON "reviews" USING btree ("address_id","created_at" desc) WHERE "reviews"."moderation_status" <> 'removed';--> statement-breakpoint
CREATE INDEX "reviews_street_level_idx" ON "reviews" USING btree ("street_level_id","address_level","created_at" desc) WHERE "reviews"."moderation_status" <> 'removed';--> statement-breakpoint
CREATE INDEX "reviews_building_level_idx" ON "reviews" USING btree ("building_level_id","address_level","created_at" desc) WHERE "reviews"."moderation_status" <> 'removed';--> statement-breakpoint
CREATE INDEX "reviews_unit_level_idx" ON "reviews" USING btree ("unit_level_id","address_level","created_at" desc) WHERE "reviews"."moderation_status" <> 'removed';--> statement-breakpoint
CREATE INDEX "reviews_agency_created_idx" ON "reviews" USING btree ("agency_id","created_at" desc) WHERE "reviews"."moderation_status" <> 'removed';--> statement-breakpoint
CREATE INDEX "reviews_city_created_idx" ON "reviews" USING btree ("city_id","created_at" desc) WHERE "reviews"."moderation_status" <> 'removed';--> statement-breakpoint
CREATE INDEX "reviews_neighborhood_created_idx" ON "reviews" USING btree ("neighborhood_id","created_at" desc) WHERE "reviews"."moderation_status" <> 'removed';--> statement-breakpoint
CREATE INDEX "reviews_oxy_user_created_idx" ON "reviews" USING btree ("oxy_user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "reviews_moderation_queue_idx" ON "reviews" USING btree ("moderation_status","created_at" desc) WHERE "reviews"."moderation_status" <> 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "roommate_relationships_active_pair_key" ON "roommate_relationships" USING btree ("oxy_user1_id","oxy_user2_id") WHERE "roommate_relationships"."status" = 'active';--> statement-breakpoint
CREATE INDEX "roommate_relationships_user1_idx" ON "roommate_relationships" USING btree ("oxy_user1_id");--> statement-breakpoint
CREATE INDEX "roommate_relationships_user2_idx" ON "roommate_relationships" USING btree ("oxy_user2_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roommate_requests_pending_pair_key" ON "roommate_requests" USING btree ("from_oxy_user_id","to_oxy_user_id") WHERE "roommate_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "roommate_requests_from_idx" ON "roommate_requests" USING btree ("from_oxy_user_id");--> statement-breakpoint
CREATE INDEX "roommate_requests_to_status_idx" ON "roommate_requests" USING btree ("to_oxy_user_id","status");