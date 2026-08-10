-- oxy:deploy-phase=pre
--
-- Saved housing watches and explainable change alerts (#356).
--
-- PHASE: `pre`. Every statement is additive — three new tables, nine
-- `ADD COLUMN`s on `saved_searches`, indexes and CHECKs over columns that did
-- not exist a statement earlier. Nothing is dropped, renamed or narrowed, so the
-- image currently serving neither reads nor writes any of it and applying this
-- before the rollout is safe on both images.
--
-- ## There is deliberately NO CHECK tying `cadence` to `location`
--
-- The obvious constraint — a cadence other than `off` requires a stored
-- selection — was written here and then removed, because it contradicts ADR 0002
-- §11.5: a saved search with notifications and an UNCONFIRMED location "does not
-- fire; it produces one prompt to confirm". That is a row storing a preference
-- and staying silent, and the constraint makes exactly that row unstorable. The
-- rule lives in the matcher's `location is not null` predicate instead, where it
-- can be silent without being a refusal. See `db/schema/saved.ts`.
--
-- ## `query_version` is DERIVED from evidence the row already carries
--
-- The column arrives at `DEFAULT 2` — ADR 0002's contract, which every new write
-- uses — and the `UPDATE` at the bottom demotes to `1` exactly those rows with no
-- canonical `LocationSelection`. That is the only evidence a stored row has: a
-- row written before #352 holds a place LABEL in `query`, and reading a label as
-- free text (searching for the string "Barcelona") or as a place (the homonym
-- bug ADR 0002 §11.3 refuses) are both wrong. A version-1 watch therefore asks
-- for confirmation instead of firing.
--
-- It is NOT a lossy guess in the other direction. A row saved after #352 with a
-- deliberate text-only search also has `location IS NULL` and is demoted here
-- too — costing it nothing, because `cadence` defaults to `off` and the owner
-- re-confirms a location before alerting can be switched on at all.
--
-- ## LOCKS
--
-- `saved_searches` is EMPTY in production (recorded at the Postgres cutover and
-- unchanged since), so the STORED generated column's table rewrite and the
-- ACCESS EXCLUSIVE the CHECKs and indexes take are on nothing. If that stops
-- being true, `area_geo` is the statement to watch: a stored generated column
-- rewrites every row.
CREATE TABLE "housing_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"watch_id" text NOT NULL,
	"oxy_user_id" text NOT NULL,
	"event_id" text,
	"rule_type" text NOT NULL,
	"rule_version" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"cooldown_bucket" timestamp with time zone,
	"explanation" jsonb NOT NULL,
	"delivery_state" text DEFAULT 'pending' NOT NULL,
	"suppression_reason" text,
	"delivered_channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"delivered_at" timestamp with time zone,
	"notification_id" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "housing_alerts_rule_type_check" CHECK ("housing_alerts"."rule_type" in ('new_listing', 'price_decrease', 'price_increase', 'cost_terms_changed', 'listing_removed', 'listing_reappeared', 'new_review', 'eviction_nearby', 'source_conflict')),
	CONSTRAINT "housing_alerts_subject_type_check" CHECK ("housing_alerts"."subject_type" in ('property', 'address', 'eviction', 'review')),
	CONSTRAINT "housing_alerts_delivery_state_check" CHECK ("housing_alerts"."delivery_state" in ('pending', 'delivered', 'suppressed', 'failed')),
	CONSTRAINT "housing_alerts_suppression_reason_check" CHECK ("housing_alerts"."suppression_reason" is null or "housing_alerts"."suppression_reason" in ('muted', 'cadence_off', 'channel_unavailable', 'rate_limited')),
	CONSTRAINT "housing_alerts_suppression_coherence_check" CHECK (("housing_alerts"."delivery_state" = 'suppressed') = ("housing_alerts"."suppression_reason" is not null)),
	CONSTRAINT "housing_alerts_delivered_channels_check" CHECK ("housing_alerts"."delivery_state" <> 'delivered' or cardinality("housing_alerts"."delivered_channels") >= 1)
);
--> statement-breakpoint
CREATE TABLE "housing_domain_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"transition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"longitude" double precision,
	"latitude" double precision,
	"geo" "geography" GENERATED ALWAYS AS (case when longitude is null or latitude is null then null
          else ST_MakePoint(longitude, latitude)::geography end) STORED,
	"is_backfill" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "housing_domain_events_type_check" CHECK ("housing_domain_events"."type" in ('new_listing', 'price_decrease', 'price_increase', 'cost_terms_changed', 'listing_removed', 'listing_reappeared', 'new_review', 'eviction_nearby', 'source_conflict')),
	CONSTRAINT "housing_domain_events_subject_type_check" CHECK ("housing_domain_events"."subject_type" in ('property', 'address', 'eviction', 'review')),
	CONSTRAINT "housing_domain_events_coordinate_pair_check" CHECK (("housing_domain_events"."longitude" is null) = ("housing_domain_events"."latitude" is null)),
	CONSTRAINT "housing_domain_events_coordinate_range_check" CHECK ("housing_domain_events"."longitude" is null or (
        "housing_domain_events"."longitude" between -180 and 180 and "housing_domain_events"."latitude" between -90 and 90
      ))
);
--> statement-breakpoint
CREATE TABLE "housing_watch_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"watch_id" text NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"threshold" double precision,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "housing_watch_rules_type_check" CHECK ("housing_watch_rules"."type" in ('new_listing', 'price_decrease', 'price_increase', 'cost_terms_changed', 'listing_removed', 'listing_reappeared', 'new_review', 'eviction_nearby', 'source_conflict')),
	CONSTRAINT "housing_watch_rules_threshold_check" CHECK (threshold is null or (threshold >= 0 and threshold <= 1000))
);
--> statement-breakpoint
ALTER TABLE "saved_searches" ADD COLUMN "query_version" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD COLUMN "is_primary_area" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD COLUMN "cadence" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD COLUMN "channels" text[] DEFAULT '{in_app}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD COLUMN "muted_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD COLUMN "alerts_active_from" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD COLUMN "push_privacy_mode" text DEFAULT 'discreet' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD COLUMN "area" jsonb;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD COLUMN "area_geo" "geography" GENERATED ALWAYS AS (case when area is null then null else ST_GeomFromGeoJSON(area)::geography end) STORED;--> statement-breakpoint
ALTER TABLE "housing_alerts" ADD CONSTRAINT "housing_alerts_watch_id_saved_searches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."saved_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housing_alerts" ADD CONSTRAINT "housing_alerts_event_id_housing_domain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."housing_domain_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housing_alerts" ADD CONSTRAINT "housing_alerts_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housing_watch_rules" ADD CONSTRAINT "housing_watch_rules_watch_id_saved_searches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."saved_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "housing_alerts_idempotency_key" ON "housing_alerts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "housing_alerts_cooldown_key" ON "housing_alerts" USING btree ("watch_id","rule_type","subject_type","subject_id","cooldown_bucket");--> statement-breakpoint
CREATE INDEX "housing_alerts_owner_created_idx" ON "housing_alerts" USING btree ("oxy_user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "housing_alerts_watch_created_idx" ON "housing_alerts" USING btree ("watch_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "housing_alerts_pending_idx" ON "housing_alerts" USING btree ("oxy_user_id","created_at") WHERE "housing_alerts"."delivery_state" = 'pending';--> statement-breakpoint
CREATE INDEX "housing_domain_events_unprocessed_idx" ON "housing_domain_events" USING btree ("occurred_at") WHERE "housing_domain_events"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "housing_domain_events_geo_gist" ON "housing_domain_events" USING gist ("geo") WHERE "housing_domain_events"."geo" is not null;--> statement-breakpoint
CREATE INDEX "housing_domain_events_subject_idx" ON "housing_domain_events" USING btree ("subject_type","subject_id","occurred_at" desc);--> statement-breakpoint
CREATE INDEX "housing_domain_events_expires_at_idx" ON "housing_domain_events" USING btree ("expires_at") WHERE "housing_domain_events"."expires_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "housing_watch_rules_watch_type_key" ON "housing_watch_rules" USING btree ("watch_id","type");--> statement-breakpoint
CREATE INDEX "housing_watch_rules_type_enabled_idx" ON "housing_watch_rules" USING btree ("type") WHERE "housing_watch_rules"."enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "saved_searches_primary_area_key" ON "saved_searches" USING btree ("oxy_user_id") WHERE "saved_searches"."is_primary_area";--> statement-breakpoint
CREATE INDEX "saved_searches_area_geo_gist" ON "saved_searches" USING gist ("area_geo") WHERE "saved_searches"."area_geo" is not null;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_cadence_check" CHECK ("saved_searches"."cadence" in ('instant', 'daily', 'weekly', 'off'));--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_push_privacy_mode_check" CHECK ("saved_searches"."push_privacy_mode" in ('discreet', 'detailed'));--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_channels_check" CHECK ("saved_searches"."channels" <@ ARRAY['in_app', 'push', 'email']::text[]
        and cardinality("saved_searches"."channels") >= 1
        and 'in_app' = any("saved_searches"."channels"));--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_query_version_check" CHECK (query_version >= 1);
--> statement-breakpoint
-- A saved search with no canonical selection predates the location contract.
-- See the header: this is a DERIVATION from the row's own evidence, not a guess
-- about what the user meant, and it makes such a row ask rather than fire.
UPDATE "saved_searches" SET "query_version" = 1 WHERE "location" IS NULL;
