-- oxy:deploy-phase=pre
--
-- The root of Homiio's foreign-key graph: countries -> regions -> cities ->
-- neighborhoods, plus images and addresses. Every property reaches its place
-- through an address, so nothing else can be ported before these six.
--
-- PHASE: `pre`. Purely additive — six new tables, no drop, no rename, no
-- narrowed constraint — so it is correct against the image currently serving
-- (which reads none of these) as well as the one arriving.
--
-- PREREQUISITE: PostGIS, unaccent and pg_trgm must already be installed in this
-- database, and the application role CANNOT install them: they are not TRUSTED
-- extensions, so `CREATE EXTENSION` needs `rds_superuser` on RDS and OWNING the
-- database is not sufficient. `db/migrate.ts` runs `ensureExtensions` before
-- applying anything, which is a no-op where they exist and a hard failure where
-- they do not — deliberately, because the alternative is failing here instead,
-- at the first statement that names `geography`, with
-- `ERROR: type "geography" does not exist`.
--
-- `homiio_simple` (the unaccent-aware text-search configuration) is created by
-- the same step. Migration 0000 does not name it — the first tsvector arrives
-- with `properties` — but a text-search configuration is PER DATABASE and does
-- not travel through `template1`, so it is created for every database, ephemeral
-- test databases included, rather than assumed to exist.
--
CREATE TABLE "addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"country_id" text NOT NULL,
	"region_id" text NOT NULL,
	"city_id" text NOT NULL,
	"neighborhood_id" text,
	"country_code" text NOT NULL,
	"street" text NOT NULL,
	"postal_code" text NOT NULL,
	"number" text,
	"building_name" text,
	"block" text,
	"entrance" text,
	"floor" text,
	"unit" text,
	"subunit" text,
	"district" text,
	"address_lines" text[] DEFAULT '{}' NOT NULL,
	"po_box" text,
	"reference" text,
	"land_plot_block" text,
	"land_plot_lot" text,
	"land_plot_parcel" text,
	"extras" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"longitude" double precision NOT NULL,
	"latitude" double precision NOT NULL,
	"geo" "geography" GENERATED ALWAYS AS (ST_MakePoint(longitude, latitude)::geography) STORED,
	"address_level" text GENERATED ALWAYS AS (
      case
        when coalesce(floor, '') <> '' or coalesce(unit, '') <> ''
          or coalesce(subunit, '') <> '' then 'UNIT'
        when coalesce(number, '') <> '' or coalesce(building_name, '') <> ''
          or coalesce(block, '') <> '' or coalesce(entrance, '') <> '' then 'BUILDING'
        else 'STREET'
      end
    ) STORED,
	"normalized_key" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "addresses_address_level_check" CHECK ("addresses"."address_level" in ('STREET', 'BUILDING', 'UNIT')),
	CONSTRAINT "addresses_coordinates_range_check" CHECK ("addresses"."longitude" between -180 and 180 and "addresses"."latitude" between -90 and 90)
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country_id" text NOT NULL,
	"region_id" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"timezone" text,
	"population" integer,
	"description" text,
	"average_rent" double precision,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"cover_image_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"properties_count" integer DEFAULT 0 NOT NULL,
	"last_updated" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "cities_currency_check" CHECK ("cities"."currency" in ('USD', 'EUR', 'GBP', 'CAD', 'PLN', 'MXN', 'ARS', 'RON', 'COP', 'CLP', 'PEN', 'BRL', 'AUD', 'AED', 'FAIR'))
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"flag" text,
	"default_locale" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "countries_currency_check" CHECK ("countries"."currency" in ('USD', 'EUR', 'GBP', 'CAD', 'PLN', 'MXN', 'ARS', 'RON', 'COP', 'CLP', 'PEN', 'BRL', 'AUD', 'AED', 'FAIR'))
);
--> statement-breakpoint
CREATE TABLE "images" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"keys_original" text NOT NULL,
	"keys_small" text NOT NULL,
	"keys_medium" text NOT NULL,
	"keys_large" text NOT NULL,
	"urls_original" text NOT NULL,
	"urls_small" text NOT NULL,
	"urls_medium" text NOT NULL,
	"urls_large" text NOT NULL,
	"width" integer,
	"height" integer,
	"format" text NOT NULL,
	"bytes" integer NOT NULL,
	"caption" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "images_entity_type_check" CHECK ("images"."entity_type" in ('property', 'city', 'region', 'country', 'profile'))
);
--> statement-breakpoint
CREATE TABLE "neighborhoods" (
	"id" text PRIMARY KEY NOT NULL,
	"city_id" text NOT NULL,
	"name" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"bbox_west" double precision,
	"bbox_south" double precision,
	"bbox_east" double precision,
	"bbox_north" double precision,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "neighborhoods_bbox_complete_check" CHECK ((
        "neighborhoods"."bbox_west" is null and "neighborhoods"."bbox_south" is null
        and "neighborhoods"."bbox_east" is null and "neighborhoods"."bbox_north" is null
      ) or (
        "neighborhoods"."bbox_west" is not null and "neighborhoods"."bbox_south" is not null
        and "neighborhoods"."bbox_east" is not null and "neighborhoods"."bbox_north" is not null
      ))
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" text PRIMARY KEY NOT NULL,
	"country_id" text NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"cover_image_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_neighborhood_id_neighborhoods_id_fk" FOREIGN KEY ("neighborhood_id") REFERENCES "public"."neighborhoods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_cover_image_id_images_id_fk" FOREIGN KEY ("cover_image_id") REFERENCES "public"."images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "neighborhoods" ADD CONSTRAINT "neighborhoods_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_cover_image_id_images_id_fk" FOREIGN KEY ("cover_image_id") REFERENCES "public"."images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "addresses_normalized_key_key" ON "addresses" USING btree ("normalized_key") WHERE "addresses"."normalized_key" is not null;--> statement-breakpoint
CREATE INDEX "addresses_geo_gist" ON "addresses" USING gist ("geo");--> statement-breakpoint
CREATE INDEX "addresses_city_id_idx" ON "addresses" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "addresses_region_id_idx" ON "addresses" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "addresses_country_id_idx" ON "addresses" USING btree ("country_id");--> statement-breakpoint
CREATE INDEX "addresses_neighborhood_id_idx" ON "addresses" USING btree ("neighborhood_id");--> statement-breakpoint
CREATE INDEX "addresses_postal_code_country_idx" ON "addresses" USING btree ("postal_code","country_code");--> statement-breakpoint
CREATE UNIQUE INDEX "cities_region_name_key" ON "cities" USING btree ("region_id","name");--> statement-breakpoint
CREATE INDEX "cities_country_id_idx" ON "cities" USING btree ("country_id");--> statement-breakpoint
CREATE INDEX "cities_active_popularity_idx" ON "cities" USING btree ("properties_count" desc,"name") WHERE "cities"."is_active";--> statement-breakpoint
CREATE INDEX "cities_name_lower_idx" ON "cities" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "cities_name_trgm_idx" ON "cities" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "countries_code_key" ON "countries" USING btree ("code");--> statement-breakpoint
CREATE INDEX "countries_name_lower_idx" ON "countries" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "images_entity_order_idx" ON "images" USING btree ("entity_type","entity_id","order");--> statement-breakpoint
CREATE UNIQUE INDEX "neighborhoods_city_name_key" ON "neighborhoods" USING btree ("city_id","name");--> statement-breakpoint
CREATE INDEX "neighborhoods_name_lower_idx" ON "neighborhoods" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "neighborhoods_name_trgm_idx" ON "neighborhoods" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "regions_country_name_key" ON "regions" USING btree ("country_id","name");--> statement-breakpoint
CREATE INDEX "regions_name_lower_idx" ON "regions" USING btree (lower("name"));