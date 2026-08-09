-- oxy:deploy-phase=pre
--
-- `properties` (135 columns) plus `property_images`, `property_documents` and
-- `property_availability_windows`. The listing, and the largest table in the
-- migration.
--
-- PHASE: `pre`. Purely additive — four new tables, no drop, no rename, and no
-- narrowed constraint on anything migrations 0000 or 0001 created — so it is
-- correct against the image currently serving (which reads none of these) as
-- well as the one arriving.
--
-- INDEPENDENT OF 0001. `0001_geo_lookup_indexes` adds indexes to `countries`,
-- `regions`, `cities`, `neighborhoods` and `addresses`; this file creates four
-- tables that did not exist and alters none of those. The only edge between
-- them is `properties.address_id -> addresses.id`, and `addresses` comes from
-- 0000. Verified by applying 0000 -> 0001 -> 0002 to an empty database, not
-- inferred from the file contents.
--
-- PREREQUISITES, both already satisfied by `db/migrate.ts` before this file is
-- applied, and both silent if they are not:
--
--   * `properties.search_vector` is a GENERATED column naming the
--     `homiio_simple` text-search configuration as a LITERAL. A text-search
--     configuration is PER DATABASE and does not travel through `template1`, so
--     `ensureExtensions` creates it for every database — a developer's, CI's,
--     every ephemeral jest database, and RDS. Without it this file fails at the
--     `properties` CREATE with `text search configuration "homiio_simple" does
--     not exist`.
--   * The two-argument `to_tsvector('homiio_simple', …)` is mandatory, not
--     stylistic: the one-argument form reads `default_text_search_config` at
--     runtime and is therefore STABLE, which Postgres refuses in a generated
--     column.
--
-- `property_availability_windows_range_gist` indexes
-- `tstzrange(starts_at, ends_at)` rather than the two btrees Mongo carried on
-- `availabilityWindows.start` and `.end`. Two independent btrees cannot answer
-- an overlap query — the planner narrows on one and filters the rest by hand —
-- so those two indexes are deliberately not ported. `tstzrange(timestamptz,
-- timestamptz)` is IMMUTABLE, which the expression index requires, and it
-- defaults to `[)` bounds, which is the half-open contract `shared-types`
-- specifies.
--
CREATE TABLE "properties" (
	"id" text PRIMARY KEY NOT NULL,
	"oxy_user_id" text,
	"source" text DEFAULT 'internal' NOT NULL,
	"source_id" text,
	"source_url" text,
	"is_external" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"sourced_by_partner_id" text,
	"sourced_by_referral_code" text,
	"agency_id" text,
	"external_contact_phone" text,
	"external_contact_email" text,
	"external_contact_whatsapp" text,
	"external_contact_name" text,
	"external_contact_agency_name" text,
	"external_contact_kind" text,
	"listing_flags_students_only" boolean,
	"listing_flags_room_not_full_unit" boolean,
	"listing_flags_temporary_only" boolean,
	"listing_flags_gender_restricted" boolean,
	"listing_flags_workers_only" boolean,
	"listing_flags_agency_fee_payable" boolean,
	"listing_flags_no_pets" boolean,
	"listing_flags_no_smoking" boolean,
	"listing_flags_no_couples" boolean,
	"listing_flags_no_dss" boolean,
	"listing_flags_detected_language" text,
	"title" text,
	"description" text,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('homiio_simple', coalesce(description, ''))) STORED,
	"address_id" text NOT NULL,
	"show_address_number" boolean DEFAULT true NOT NULL,
	"type" text DEFAULT 'apartment' NOT NULL,
	"housing_type" text DEFAULT 'private' NOT NULL,
	"layout_type" text DEFAULT 'traditional' NOT NULL,
	"bedrooms" double precision DEFAULT 0 NOT NULL,
	"bathrooms" double precision DEFAULT 0 NOT NULL,
	"square_footage" double precision DEFAULT 0 NOT NULL,
	"floor" double precision DEFAULT 0 NOT NULL,
	"year_built" double precision,
	"has_elevator" boolean DEFAULT false NOT NULL,
	"has_balcony" boolean DEFAULT false NOT NULL,
	"has_garden" boolean DEFAULT false NOT NULL,
	"utilities_included" boolean DEFAULT false NOT NULL,
	"pet_friendly" boolean DEFAULT false NOT NULL,
	"proximity_to_transport" boolean DEFAULT false NOT NULL,
	"proximity_to_schools" boolean DEFAULT false NOT NULL,
	"proximity_to_shopping" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_eco_friendly" boolean DEFAULT false NOT NULL,
	"offerings" text[] DEFAULT '{}' NOT NULL,
	"amenities" text[] DEFAULT '{}' NOT NULL,
	"furnished_status" text DEFAULT 'not_specified' NOT NULL,
	"pet_policy" text DEFAULT 'not_specified' NOT NULL,
	"pet_fee" double precision DEFAULT 0 NOT NULL,
	"parking_type" text DEFAULT 'none' NOT NULL,
	"parking_spaces" double precision DEFAULT 0 NOT NULL,
	"lease_term" text DEFAULT 'monthly' NOT NULL,
	"cancellation_policy" text,
	"available_from" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"smoking_allowed" boolean DEFAULT false NOT NULL,
	"parties_allowed" boolean DEFAULT false NOT NULL,
	"guests_allowed" boolean DEFAULT true NOT NULL,
	"max_guests" double precision DEFAULT 1 NOT NULL,
	"long_term_rent_monthly_amount" double precision,
	"long_term_rent_currency" text,
	"long_term_rent_deposit" double precision,
	"long_term_rent_application_fee" double precision,
	"long_term_rent_late_fee" double precision,
	"long_term_rent_utilities" text,
	"short_term_rent_nightly_rate" double precision,
	"short_term_rent_currency" text,
	"short_term_rent_cleaning_fee" double precision,
	"short_term_rent_service_fee" double precision,
	"short_term_rent_taxes_percent" double precision,
	"short_term_rent_min_nights" double precision,
	"short_term_rent_max_nights" double precision,
	"short_term_rent_instant_book" boolean,
	"short_term_rent_deposit" double precision,
	"sale_price" double precision,
	"sale_currency" text,
	"sale_price_per_sqm" double precision,
	"sale_estimated_yield" double precision,
	"sale_is_price_reduced" boolean,
	"sale_chain_status" text,
	"exchange_mode" text,
	"exchange_min_stay" double precision,
	"exchange_max_stay" double precision,
	"exchange_welcome_note" text,
	"exchange_languages" text[],
	"exchange_meals_included" boolean,
	"exchange_requires_reciprocity" boolean,
	"accommodation_details_sleeping_arrangement" text,
	"accommodation_details_hostel_room_type" text,
	"accommodation_details_campsite_type" text,
	"accommodation_details_max_stay" double precision,
	"accommodation_details_min_age" double precision,
	"accommodation_details_max_age" double precision,
	"accommodation_details_cultural_exchange" boolean DEFAULT false NOT NULL,
	"accommodation_details_meals_included" boolean DEFAULT false NOT NULL,
	"accommodation_details_wifi_password" text,
	"accommodation_details_roommate_preferences" text[] DEFAULT '{}' NOT NULL,
	"accommodation_details_coliving_features" text[] DEFAULT '{}' NOT NULL,
	"accommodation_details_languages" text[] DEFAULT '{}' NOT NULL,
	"accommodation_details_house_rules" text[] DEFAULT '{}' NOT NULL,
	"availability_is_available" boolean DEFAULT true NOT NULL,
	"availability_available_from" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"availability_minimum_stay" double precision DEFAULT 1 NOT NULL,
	"availability_maximum_stay" double precision DEFAULT 12 NOT NULL,
	"rules_pets" boolean DEFAULT false NOT NULL,
	"rules_smoking" boolean DEFAULT false NOT NULL,
	"rules_parties" boolean DEFAULT false NOT NULL,
	"rules_guests" boolean DEFAULT true NOT NULL,
	"rules_max_occupancy" double precision DEFAULT 1 NOT NULL,
	"moderation_restricted" boolean DEFAULT false NOT NULL,
	"moderation_restricted_at" timestamp with time zone,
	"moderation_restricted_by_decision_id" text,
	"price_ethics_ethical_suggested" double precision,
	"price_ethics_ethical_max" double precision,
	"price_ethics_within_ethical" boolean,
	"price_ethics_market_verdict" text,
	"price_ethics_percent_diff_from_avg" double precision,
	"price_ethics_is_fair_price" boolean,
	"price_ethics_fairness_score" double precision,
	"price_ethics_scored_at" timestamp with time zone,
	"rating_average" double precision DEFAULT 0 NOT NULL,
	"rating_count" bigint DEFAULT 0 NOT NULL,
	"views" bigint DEFAULT 0 NOT NULL,
	"has_images" boolean DEFAULT false NOT NULL,
	"last_saved" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"parent_property_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "properties_source_check" CHECK ("properties"."source" in ('internal', 'fixture', 'idealista', 'fotocasa', 'habitaclia', 'blueground', 'apartments_com', 'zillow', 'realtor_com', 'hotpads', 'redfin', 'pisos', 'milanuncios', 'yaencontre', 'indomio', 'idealista_it', 'immobiliare', 'casa_it', 'subito', 'rightmove', 'zoopla', 'onthemarket', 'openrent', 'immobilienscout24', 'immowelt', 'kleinanzeigen', 'storia', 'imobiliare_ro', 'olx_ro', 'bienici', 'leboncoin', 'seloger', 'properati_ec', 'zonaprop', 'argenprop', 'mercadolibre_ar', 'properati', 'plusvalia', 'mercadolibre_ec', 'propiedades', 'vivanuncios', 'lamudi', 'inmuebles24', 'mercadolibre_co', 'mercadolibre_cl', 'mercadolibre_pe', 'mercadolibre_mx', 'idealista_pt', 'metrocuadrado', 'realestate_com_au', 'realtor_ca', 'bayut', 'daft', 'immoweb', 'otodom', 'funda')),
	CONSTRAINT "properties_type_check" CHECK ("properties"."type" in ('apartment', 'house', 'room', 'studio', 'couchsurfing', 'roommates', 'coliving', 'hostel', 'guesthouse', 'campsite', 'boat', 'treehouse', 'yurt', 'other')),
	CONSTRAINT "properties_status_check" CHECK ("properties"."status" in ('draft', 'published', 'reserved', 'rented', 'sold', 'inactive', 'archived')),
	CONSTRAINT "properties_housing_type_check" CHECK ("properties"."housing_type" in ('private', 'public')),
	CONSTRAINT "properties_layout_type_check" CHECK ("properties"."layout_type" in ('open', 'shared', 'partitioned', 'traditional', 'studio', 'other')),
	CONSTRAINT "properties_furnished_status_check" CHECK ("properties"."furnished_status" in ('furnished', 'unfurnished', 'partially_furnished', 'not_specified')),
	CONSTRAINT "properties_pet_policy_check" CHECK ("properties"."pet_policy" in ('allowed', 'not_allowed', 'case_by_case', 'not_specified')),
	CONSTRAINT "properties_parking_type_check" CHECK ("properties"."parking_type" in ('none', 'street', 'assigned', 'garage')),
	CONSTRAINT "properties_lease_term_check" CHECK ("properties"."lease_term" in ('monthly', '3_months', '6_months', 'yearly', 'flexible')),
	CONSTRAINT "properties_cancellation_policy_check" CHECK ("properties"."cancellation_policy" in ('flexible', 'moderate', 'strict', 'super_strict')),
	CONSTRAINT "properties_external_contact_kind_check" CHECK ("properties"."external_contact_kind" in ('owner', 'agency', 'private', 'unknown')),
	CONSTRAINT "properties_detected_language_check" CHECK ("properties"."listing_flags_detected_language" in ('es', 'ca', 'en', 'fr', 'nl', 'de', 'it')),
	CONSTRAINT "properties_long_term_rent_currency_check" CHECK ("properties"."long_term_rent_currency" in ('USD', 'EUR', 'GBP', 'CAD', 'PLN', 'MXN', 'ARS', 'RON', 'COP', 'CLP', 'PEN', 'BRL', 'AUD', 'AED', 'FAIR')),
	CONSTRAINT "properties_long_term_rent_utilities_check" CHECK ("properties"."long_term_rent_utilities" in ('included', 'excluded', 'partial')),
	CONSTRAINT "properties_short_term_rent_currency_check" CHECK ("properties"."short_term_rent_currency" in ('USD', 'EUR', 'GBP', 'CAD', 'PLN', 'MXN', 'ARS', 'RON', 'COP', 'CLP', 'PEN', 'BRL', 'AUD', 'AED', 'FAIR')),
	CONSTRAINT "properties_sale_currency_check" CHECK ("properties"."sale_currency" in ('USD', 'EUR', 'GBP', 'CAD', 'PLN', 'MXN', 'ARS', 'RON', 'COP', 'CLP', 'PEN', 'BRL', 'AUD', 'AED', 'FAIR')),
	CONSTRAINT "properties_sale_chain_status_check" CHECK ("properties"."sale_chain_status" in ('no_chain', 'chain', 'unknown')),
	CONSTRAINT "properties_exchange_mode_check" CHECK ("properties"."exchange_mode" in ('swap', 'host', 'both')),
	CONSTRAINT "properties_market_verdict_check" CHECK ("properties"."price_ethics_market_verdict" in ('good_deal', 'below_average', 'average', 'above_average')),
	CONSTRAINT "properties_sleeping_arrangement_check" CHECK ("properties"."accommodation_details_sleeping_arrangement" in ('couch', 'air_mattress', 'floor', 'tent', 'hammock')),
	CONSTRAINT "properties_hostel_room_type_check" CHECK ("properties"."accommodation_details_hostel_room_type" in ('dormitory', 'private_room', 'mixed_dorm', 'female_dorm', 'male_dorm')),
	CONSTRAINT "properties_campsite_type_check" CHECK ("properties"."accommodation_details_campsite_type" in ('tent_site', 'rv_site', 'cabin', 'glamping', 'backcountry')),
	CONSTRAINT "properties_offerings_check" CHECK ("properties"."offerings" <@ array['long_term_rent', 'short_term_rent', 'sale', 'exchange']::text[]),
	CONSTRAINT "properties_offering_long_term_rent_check" CHECK (('long_term_rent' = any("properties"."offerings")) = ("properties"."long_term_rent_monthly_amount" is not null)),
	CONSTRAINT "properties_offering_short_term_rent_check" CHECK (('short_term_rent' = any("properties"."offerings")) = ("properties"."short_term_rent_nightly_rate" is not null)),
	CONSTRAINT "properties_offering_sale_check" CHECK (('sale' = any("properties"."offerings")) = ("properties"."sale_price" is not null)),
	CONSTRAINT "properties_offering_exchange_check" CHECK (('exchange' = any("properties"."offerings")) = ("properties"."exchange_mode" is not null)),
	CONSTRAINT "properties_long_term_rent_block_check" CHECK ("properties"."long_term_rent_monthly_amount" is not null or (
        "properties"."long_term_rent_currency" is null and "properties"."long_term_rent_deposit" is null
        and "properties"."long_term_rent_application_fee" is null and "properties"."long_term_rent_late_fee" is null
        and "properties"."long_term_rent_utilities" is null
      )),
	CONSTRAINT "properties_short_term_rent_block_check" CHECK ("properties"."short_term_rent_nightly_rate" is not null or (
        "properties"."short_term_rent_currency" is null and "properties"."short_term_rent_cleaning_fee" is null
        and "properties"."short_term_rent_service_fee" is null and "properties"."short_term_rent_taxes_percent" is null
        and "properties"."short_term_rent_min_nights" is null and "properties"."short_term_rent_max_nights" is null
        and "properties"."short_term_rent_instant_book" is null and "properties"."short_term_rent_deposit" is null
      )),
	CONSTRAINT "properties_sale_block_check" CHECK ("properties"."sale_price" is not null or (
        "properties"."sale_currency" is null and "properties"."sale_price_per_sqm" is null
        and "properties"."sale_estimated_yield" is null and "properties"."sale_is_price_reduced" is null
        and "properties"."sale_chain_status" is null
      )),
	CONSTRAINT "properties_exchange_block_check" CHECK ("properties"."exchange_mode" is not null or (
        "properties"."exchange_min_stay" is null and "properties"."exchange_max_stay" is null
        and "properties"."exchange_welcome_note" is null and "properties"."exchange_languages" is null
        and "properties"."exchange_meals_included" is null and "properties"."exchange_requires_reciprocity" is null
      )),
	CONSTRAINT "properties_external_source_url_check" CHECK (not "properties"."is_external" or "properties"."source_url" is not null)
);
--> statement-breakpoint
CREATE TABLE "property_availability_windows" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"scope" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	CONSTRAINT "property_availability_windows_scope_check" CHECK ("property_availability_windows"."scope" in ('listing', 'exchange')),
	CONSTRAINT "property_availability_windows_status_check" CHECK ("property_availability_windows"."status" in ('available', 'blocked', 'booked')),
	CONSTRAINT "property_availability_windows_order_check" CHECK ("property_availability_windows"."ends_at" > "property_availability_windows"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "property_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	CONSTRAINT "property_documents_type_check" CHECK ("property_documents"."type" in ('lease', 'inspection', 'insurance', 'other'))
);
--> statement-breakpoint
CREATE TABLE "property_images" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"image_id" text NOT NULL,
	"url" text,
	"caption" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"order" bigint DEFAULT 0 NOT NULL,
	"urls_original" text,
	"urls_small" text,
	"urls_medium" text,
	"urls_large" text
);
--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_parent_property_id_properties_id_fk" FOREIGN KEY ("parent_property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_availability_windows" ADD CONSTRAINT "property_availability_windows_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_documents" ADD CONSTRAINT "property_documents_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_images" ADD CONSTRAINT "property_images_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_images" ADD CONSTRAINT "property_images_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "properties_source_source_id_key" ON "properties" USING btree ("source","source_id") WHERE "properties"."source_id" is not null;--> statement-breakpoint
CREATE INDEX "properties_has_images_created_at_idx" ON "properties" USING btree ("has_images" desc,"created_at" desc);--> statement-breakpoint
CREATE INDEX "properties_created_at_idx" ON "properties" USING btree ("created_at" desc);--> statement-breakpoint
CREATE INDEX "properties_search_vector_gin" ON "properties" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "properties_oxy_user_id_status_idx" ON "properties" USING btree ("oxy_user_id","status");--> statement-breakpoint
CREATE INDEX "properties_oxy_user_id_created_at_idx" ON "properties" USING btree ("oxy_user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "properties_address_id_idx" ON "properties" USING btree ("address_id");--> statement-breakpoint
CREATE INDEX "properties_type_available_idx" ON "properties" USING btree ("type","availability_is_available");--> statement-breakpoint
CREATE INDEX "properties_status_available_idx" ON "properties" USING btree ("status","availability_is_available");--> statement-breakpoint
CREATE INDEX "properties_bedrooms_bathrooms_idx" ON "properties" USING btree ("bedrooms","bathrooms");--> statement-breakpoint
CREATE INDEX "properties_amenities_gin" ON "properties" USING gin ("amenities");--> statement-breakpoint
CREATE INDEX "properties_offerings_gin" ON "properties" USING gin ("offerings");--> statement-breakpoint
CREATE INDEX "properties_long_term_rent_amount_idx" ON "properties" USING btree ("long_term_rent_monthly_amount");--> statement-breakpoint
CREATE INDEX "properties_short_term_rent_rate_idx" ON "properties" USING btree ("short_term_rent_nightly_rate");--> statement-breakpoint
CREATE INDEX "properties_sale_price_idx" ON "properties" USING btree ("sale_price");--> statement-breakpoint
CREATE INDEX "properties_price_ethics_is_fair_idx" ON "properties" USING btree ("price_ethics_is_fair_price");--> statement-breakpoint
CREATE INDEX "properties_price_ethics_score_idx" ON "properties" USING btree ("price_ethics_fairness_score" desc);--> statement-breakpoint
CREATE INDEX "properties_agency_id_idx" ON "properties" USING btree ("agency_id") WHERE "properties"."agency_id" is not null;--> statement-breakpoint
CREATE INDEX "properties_sourced_by_partner_id_idx" ON "properties" USING btree ("sourced_by_partner_id") WHERE "properties"."sourced_by_partner_id" is not null;--> statement-breakpoint
CREATE INDEX "properties_parent_property_id_idx" ON "properties" USING btree ("parent_property_id") WHERE "properties"."parent_property_id" is not null;--> statement-breakpoint
CREATE INDEX "properties_expires_at_idx" ON "properties" USING btree ("expires_at") WHERE "properties"."expires_at" is not null;--> statement-breakpoint
CREATE INDEX "property_availability_windows_range_gist" ON "property_availability_windows" USING gist (tstzrange("starts_at", "ends_at"));--> statement-breakpoint
CREATE INDEX "property_availability_windows_property_scope_idx" ON "property_availability_windows" USING btree ("property_id","scope");--> statement-breakpoint
CREATE INDEX "property_documents_property_id_idx" ON "property_documents" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "property_images_property_order_idx" ON "property_images" USING btree ("property_id","order");--> statement-breakpoint
CREATE UNIQUE INDEX "property_images_one_primary_key" ON "property_images" USING btree ("property_id") WHERE "property_images"."is_primary";--> statement-breakpoint
CREATE INDEX "property_images_image_id_idx" ON "property_images" USING btree ("image_id");